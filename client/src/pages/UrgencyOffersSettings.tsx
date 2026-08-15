import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, ArrowLeft, Timer, Gift, MessageSquare, Sparkles, ChevronDown, ChevronUp, Phone, Clock, Target, Search, Brain, Plus, Pencil, Trash2 } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";

interface UrgencyOfferCampaign {
  id?: string;
  name: string;
  priority: number;
  isEnabled: boolean;
  countdownDurationMinutes: number;
  discountType: string;
  discountValue: number;
  headline: string;
  description: string;
  ctaButtonText: string;
  dismissButtonText: string;
  successMessage: string;
  phoneInputLabel: string;
  phoneInputPlaceholder: string;
  requirePhone: boolean;
  triggerMode: string;
  triggerKeywords: string;
  intentThreshold: number;
  minMessagesBeforeTrigger: number;
}

const defaultCampaign: UrgencyOfferCampaign = {
  name: "",
  priority: 0,
  isEnabled: false,
  countdownDurationMinutes: 10,
  discountType: "percentage",
  discountValue: 10,
  headline: "Limited Time Offer!",
  description: "We noticed you're interested! Here's a special discount just for you.",
  ctaButtonText: "Unlock Offer",
  dismissButtonText: "Maybe later",
  successMessage: "Your discount code has been sent to your WhatsApp!",
  phoneInputLabel: "Enter your WhatsApp number",
  phoneInputPlaceholder: "9999-0808-25",
  requirePhone: true,
  triggerMode: "intent",
  triggerKeywords: "",
  intentThreshold: 70,
  minMessagesBeforeTrigger: 3,
};

const durationOptions = [
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
];

const discountPresets = [5, 10, 15, 20, 25];

export default function UrgencyOffersSettings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [form, setForm] = useState<UrgencyOfferCampaign>({ ...defaultCampaign });
  const [textSettingsOpen, setTextSettingsOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: campaigns, isLoading } = useQuery<UrgencyOfferCampaign[]>({
    queryKey: ["/api/urgency-offer-settings"],
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isEnabled }: { id: string; isEnabled: boolean }) => {
      return await apiRequest("PUT", `/api/urgency-offer-settings/${id}`, { isEnabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/urgency-offer-settings"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: UrgencyOfferCampaign) => {
      const { id, ...body } = data;
      return await apiRequest("POST", "/api/urgency-offer-settings", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/urgency-offer-settings"] });
      toast({ title: "Campaign created", description: "Your new campaign has been created" });
      setView('list');
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create campaign", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: UrgencyOfferCampaign) => {
      return await apiRequest("PUT", `/api/urgency-offer-settings/${data.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/urgency-offer-settings"] });
      toast({ title: "Campaign updated", description: "Your campaign settings have been saved" });
      setView('list');
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save campaign", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/urgency-offer-settings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/urgency-offer-settings"] });
      toast({ title: "Campaign deleted", description: "The campaign has been removed" });
      setDeleteConfirmId(null);
      if (view === 'edit') setView('list');
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete campaign", variant: "destructive" });
    },
  });

  const handleCreate = () => {
    setForm({ ...defaultCampaign });
    setTextSettingsOpen(false);
    setAiSettingsOpen(false);
    setView('create');
  };

  const handleEdit = (campaign: UrgencyOfferCampaign) => {
    setForm({ ...campaign });
    setEditingCampaignId(campaign.id || null);
    setTextSettingsOpen(false);
    setAiSettingsOpen(false);
    setView('edit');
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      toast({ title: "Validation Error", description: "Campaign name is required", variant: "destructive" });
      return;
    }
    if (view === 'create') {
      createMutation.mutate(form);
    } else {
      updateMutation.mutate(form);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (view === 'create' || view === 'edit') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
        <div className="container mx-auto py-8 px-4 max-w-3xl">
          <Button variant="ghost" size="sm" onClick={() => setView('list')} className="mb-6 -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Campaigns
          </Button>

          <div className="mb-8">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-purple-500/20">
                <Timer className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h1 className="text-2xl font-bold tracking-tight">
                  {view === 'create' ? 'Create Campaign' : 'Edit Campaign'}
                </h1>
                <p className="text-muted-foreground">
                  {view === 'create' ? 'Set up a new urgency offer campaign' : 'Modify your campaign settings'}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                    <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Campaign Info</CardTitle>
                    <CardDescription>Name and priority for this campaign</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Campaign Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Summer Sale Intent Offer"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Priority</Label>
                    <Input
                      type="number"
                      value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                      min={0}
                      placeholder="0 = highest"
                    />
                    <p className="text-xs text-muted-foreground">Lower number = higher priority</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Status</Label>
                    <div className="flex items-center gap-3 h-10">
                      <Switch
                        checked={form.isEnabled}
                        onCheckedChange={(checked) => setForm({ ...form, isEnabled: checked })}
                      />
                      <span className="text-sm">{form.isEnabled ? 'Active' : 'Inactive'}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                    <Gift className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Discount Details</CardTitle>
                    <CardDescription>Set your offer amount and timer</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Timer Duration</Label>
                    <div className="flex gap-1.5 flex-wrap">
                      {durationOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setForm({ ...form, countdownDurationMinutes: parseInt(opt.value) })}
                          className={`py-2 px-3 text-sm rounded-lg border transition-all ${
                            form.countdownDurationMinutes === parseInt(opt.value)
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-muted border-input'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Discount Type</Label>
                    <Select
                      value={form.discountType}
                      onValueChange={(value) => setForm({ ...form, discountType: value })}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage">Percentage (%)</SelectItem>
                        <SelectItem value="fixed">Fixed Amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Discount Value</Label>
                    <span className="text-2xl font-bold text-primary">
                      {form.discountType === 'percentage' ? `${form.discountValue}%` : `$${form.discountValue}`}
                    </span>
                  </div>
                  
                  {form.discountType === 'percentage' && (
                    <div className="flex gap-2">
                      {discountPresets.map((preset) => (
                        <button
                          key={preset}
                          onClick={() => setForm({ ...form, discountValue: preset })}
                          className={`flex-1 py-1.5 text-sm rounded-md border transition-all ${
                            form.discountValue === preset
                              ? 'bg-primary/10 border-primary text-primary'
                              : 'bg-background hover:bg-muted border-input text-muted-foreground'
                          }`}
                        >
                          {preset}%
                        </button>
                      ))}
                    </div>
                  )}
                  
                  <Slider
                    value={[form.discountValue]}
                    onValueChange={([value]) => setForm({ ...form, discountValue: value })}
                    min={0}
                    max={form.discountType === 'percentage' ? 50 : 100}
                    step={5}
                    className="py-2"
                  />
                  {form.discountValue === 0 && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
                      Set to 0 to show urgency without a specific discount amount
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <Label className="text-sm font-medium">Collect WhatsApp Number</Label>
                      <p className="text-xs text-muted-foreground">Require phone to claim offer</p>
                    </div>
                  </div>
                  <Switch
                    checked={form.requirePhone}
                    onCheckedChange={(checked) => setForm({ ...form, requirePhone: checked })}
                  />
                </div>
              </CardContent>
            </Card>

            <Collapsible open={textSettingsOpen} onOpenChange={setTextSettingsOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                          <MessageSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">Customize Text</CardTitle>
                          <CardDescription>Headlines, buttons, and messages</CardDescription>
                        </div>
                      </div>
                      {textSettingsOpen ? (
                        <ChevronUp className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 pt-0">
                    <div className="space-y-2">
                      <Label className="text-sm">Headline</Label>
                      <Input
                        value={form.headline}
                        onChange={(e) => setForm({ ...form, headline: e.target.value })}
                        placeholder="Limited Time Offer!"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm">Description</Label>
                      <Textarea
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        placeholder="We noticed you're interested..."
                        rows={2}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm">Button Text</Label>
                        <Input
                          value={form.ctaButtonText}
                          onChange={(e) => setForm({ ...form, ctaButtonText: e.target.value })}
                          placeholder="Unlock Offer"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm">Dismiss Text</Label>
                        <Input
                          value={form.dismissButtonText}
                          onChange={(e) => setForm({ ...form, dismissButtonText: e.target.value })}
                          placeholder="Maybe later"
                        />
                      </div>
                    </div>
                    {form.requirePhone && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-sm">Phone Input Label</Label>
                            <Input
                              value={form.phoneInputLabel}
                              onChange={(e) => setForm({ ...form, phoneInputLabel: e.target.value })}
                              placeholder="Enter your WhatsApp number"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm">Placeholder Text</Label>
                            <Input
                              value={form.phoneInputPlaceholder}
                              onChange={(e) => setForm({ ...form, phoneInputPlaceholder: e.target.value })}
                              placeholder="9999-0808-25"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Success Message</Label>
                          <Textarea
                            value={form.successMessage}
                            onChange={(e) => setForm({ ...form, successMessage: e.target.value })}
                            placeholder="Your discount code has been sent!"
                            rows={2}
                          />
                        </div>
                      </>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <Collapsible open={aiSettingsOpen} onOpenChange={setAiSettingsOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                          <Target className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">AI Detection Settings</CardTitle>
                          <CardDescription>Control when and how often offers appear</CardDescription>
                        </div>
                      </div>
                      {aiSettingsOpen ? (
                        <ChevronUp className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-6 pt-0">
                    <div className="space-y-3">
                      <Label className="text-sm font-medium">Trigger Mode</Label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, triggerMode: "intent" })}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                            form.triggerMode === "intent"
                              ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                              : "border-muted hover:border-muted-foreground/30"
                          }`}
                        >
                          <Brain className={`w-5 h-5 ${form.triggerMode === "intent" ? "text-purple-600" : "text-muted-foreground"}`} />
                          <div>
                            <div className="text-sm font-medium">AI Intent</div>
                            <div className="text-xs text-muted-foreground">AI detects buying interest</div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, triggerMode: "keyword" })}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                            form.triggerMode === "keyword"
                              ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                              : "border-muted hover:border-muted-foreground/30"
                          }`}
                        >
                          <Search className={`w-5 h-5 ${form.triggerMode === "keyword" ? "text-purple-600" : "text-muted-foreground"}`} />
                          <div>
                            <div className="text-sm font-medium">Keyword</div>
                            <div className="text-xs text-muted-foreground">Trigger on specific words</div>
                          </div>
                        </button>
                      </div>
                    </div>

                    {form.triggerMode === "keyword" ? (
                      <>
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Keywords</Label>
                          <Textarea
                            value={form.triggerKeywords}
                            onChange={(e) => setForm({ ...form, triggerKeywords: e.target.value })}
                            placeholder="price, cost, discount, buy, purchase, enroll, fees, payment"
                            rows={3}
                          />
                          <p className="text-xs text-muted-foreground">
                            Comma-separated keywords. Offer triggers when visitor's message contains any of these words (case-insensitive).
                          </p>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">Minimum Messages</Label>
                            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{form.minMessagesBeforeTrigger}</span>
                          </div>
                          <Slider
                            value={[form.minMessagesBeforeTrigger]}
                            onValueChange={([value]) => setForm({ ...form, minMessagesBeforeTrigger: value })}
                            min={1}
                            max={10}
                            step={1}
                          />
                          <p className="text-xs text-muted-foreground">
                            Wait for this many messages before checking for keywords
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">Intent Confidence</Label>
                            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{form.intentThreshold}%</span>
                          </div>
                          <Slider
                            value={[form.intentThreshold]}
                            onValueChange={([value]) => setForm({ ...form, intentThreshold: value })}
                            min={50}
                            max={95}
                            step={5}
                          />
                          <p className="text-xs text-muted-foreground">
                            Higher = more certain the visitor wants to buy before showing offer
                          </p>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">Minimum Messages</Label>
                            <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">{form.minMessagesBeforeTrigger}</span>
                          </div>
                          <Slider
                            value={[form.minMessagesBeforeTrigger]}
                            onValueChange={([value]) => setForm({ ...form, minMessagesBeforeTrigger: value })}
                            min={1}
                            max={10}
                            step={1}
                          />
                          <p className="text-xs text-muted-foreground">
                            Wait for this many messages before analyzing intent
                          </p>
                        </div>
                      </>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <div className="flex items-center gap-3 sticky bottom-4 pt-4">
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                {view === 'create' ? 'Create Campaign' : 'Save Changes'}
              </Button>
              <Button variant="outline" onClick={() => setView('list')}>
                Cancel
              </Button>
              {view === 'edit' && editingCampaignId && (
                <Button
                  variant="outline"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200"
                  onClick={() => setDeleteConfirmId(editingCampaignId)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>

            {deleteConfirmId && (
              <Card className="border-red-200 bg-red-50 dark:bg-red-900/10">
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-3">
                    Are you sure you want to delete this campaign? This action cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(deleteConfirmId)}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Delete
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDeleteConfirmId(null)}>
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  const campaignList = campaigns || [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto py-8 px-4 max-w-3xl">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/smart-discounts")} className="mb-6 -ml-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Smart Discounts
        </Button>

        <div className="mb-8">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-purple-500/20">
              <Timer className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold tracking-tight">AI Urgency Campaigns</h1>
              <p className="text-muted-foreground">Manage time-sensitive discount campaigns</p>
            </div>
            <Button
              onClick={handleCreate}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-lg"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Campaign
            </Button>
          </div>
        </div>

        {campaignList.length === 0 ? (
          <Card className="border-2 border-dashed border-muted-foreground/20">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="p-4 rounded-full bg-muted mb-4">
                <Timer className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No campaigns yet</h3>
              <p className="text-muted-foreground text-sm mb-6 text-center max-w-sm">
                Create your first urgency offer campaign to show time-sensitive discounts when visitors show buying intent.
              </p>
              <Button
                onClick={handleCreate}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create your first campaign
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {campaignList.map((campaign) => (
              <Card key={campaign.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold truncate">{campaign.name || 'Untitled Campaign'}</h3>
                        <Badge variant={campaign.isEnabled ? "default" : "secondary"} className={campaign.isEnabled ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100" : ""}>
                          {campaign.isEnabled ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        {campaign.triggerMode === 'intent' ? (
                          <Badge variant="outline" className="border-purple-200 text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20">
                            <Brain className="w-3 h-3 mr-1" />
                            AI Intent
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-blue-200 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20">
                            <Search className="w-3 h-3 mr-1" />
                            Keyword
                          </Badge>
                        )}
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <Gift className="w-3 h-3" />
                          {campaign.discountType === 'percentage' ? `${campaign.discountValue}% off` : `$${campaign.discountValue} off`}
                        </span>
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {campaign.countdownDurationMinutes} min countdown
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={campaign.isEnabled}
                        onCheckedChange={(checked) => {
                          if (campaign.id) toggleMutation.mutate({ id: campaign.id, isEnabled: checked });
                        }}
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(campaign)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {deleteConfirmId === campaign.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="destructive"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => campaign.id && deleteMutation.mutate(campaign.id)}
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteConfirmId(null)}>
                            <ArrowLeft className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-600"
                          onClick={() => setDeleteConfirmId(campaign.id || null)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
