import { useState, useEffect, useMemo } from "react";
import { GeminiAccountKeyEditor } from "@/components/photoSearch/GeminiKeyEditor";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Eye, EyeOff, Key, DollarSign, Building2, CheckCircle, Loader2, Search, ChevronsUpDown, Check, Camera, Trash2, Cpu, CloudCog, Sparkles, HelpCircle, ExternalLink, Power, PowerOff, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD - US Dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "GBP", label: "GBP - British Pound" },
  { value: "INR", label: "INR - Indian Rupee" },
  { value: "AUD", label: "AUD - Australian Dollar" },
  { value: "CAD", label: "CAD - Canadian Dollar" },
  { value: "SGD", label: "SGD - Singapore Dollar" },
  { value: "JPY", label: "JPY - Japanese Yen" },
  { value: "CNY", label: "CNY - Chinese Yuan" },
];

const apiKeySchema = z.object({
  openaiApiKey: z.string().optional(),
});

const elevenlabsKeySchema = z.object({
  elevenlabsApiKey: z.string().optional(),
});

const currencySchema = z.object({
  currency: z.string().min(3, "Currency code must be 3 letters"),
});

type ApiKeyFormData = z.infer<typeof apiKeySchema>;
type ElevenLabsKeyFormData = z.infer<typeof elevenlabsKeySchema>;
type CurrencyFormData = z.infer<typeof currencySchema>;


interface ApiSettings {
  businessAccountId: string;
  businessName: string;
  openaiApiKey: string | null;
  hasOpenAIKey: boolean;
  elevenlabsApiKey: string | null;
  hasElevenLabsKey: boolean;
  currency: string;
}

/**
 * One account's AI keys (OpenAI, ElevenLabs, Vista Studio image model, photo search) or its display
 * currency. Shown on the account's own page (AI & keys, and Details & login for currency).
 */
export default function AccountApiSettings({ businessAccountId, section }: { businessAccountId: string; section: "keys" | "currency" }) {
  const { toast } = useToast();
  const selectedBusinessId = businessAccountId;
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [googleApiKey, setGoogleApiKey] = useState("");
  const [showGoogleApiKey, setShowGoogleApiKey] = useState(false);
  const [isTestingGoogleKey, setIsTestingGoogleKey] = useState(false);
  
  const { data: apiSettings, isLoading: apiSettingsLoading } = useQuery<ApiSettings>({
    queryKey: ["/api/business-accounts", selectedBusinessId, "api-settings"],
    enabled: !!selectedBusinessId,
  });


  const { data: vistaSettings } = useQuery<{ provider: string; hasGoogleApiKey: boolean; hasOpenaiApiKey: boolean }>({
    queryKey: ["/api/business-accounts", selectedBusinessId, "vista-settings"],
    enabled: !!selectedBusinessId,
  });

  const openAIKeyForm = useForm<ApiKeyFormData>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: {
      openaiApiKey: "",
    },
  });

  const elevenLabsKeyForm = useForm<ElevenLabsKeyFormData>({
    resolver: zodResolver(elevenlabsKeySchema),
    defaultValues: {
      elevenlabsApiKey: "",
    },
  });

  const currencyForm = useForm<CurrencyFormData>({
    resolver: zodResolver(currencySchema),
    // Settings may already be cached (e.g. after the AI & keys tab), so start from them.
    defaultValues: {
      currency: apiSettings?.currency || "USD",
    },
  });

  useEffect(() => {
    if (apiSettings) {
      currencyForm.reset({ currency: apiSettings.currency || "USD" });
      openAIKeyForm.reset({ openaiApiKey: "" });
      elevenLabsKeyForm.reset({ elevenlabsApiKey: "" });
    }
  }, [apiSettings]);

  const updateOpenAIKeyMutation = useMutation({
    mutationFn: async (data: { openaiApiKey?: string }) => {
      const payload: { openaiApiKey?: string } = {};
      if (data.openaiApiKey && data.openaiApiKey.trim()) {
        payload.openaiApiKey = data.openaiApiKey.trim();
      }
      if (Object.keys(payload).length === 0) {
        throw new Error("Please enter an API key to update");
      }
      return apiRequest("PATCH", `/api/business-accounts/${selectedBusinessId}/api-settings`, payload);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "OpenAI API key updated successfully",
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/business-accounts", selectedBusinessId, "api-settings"] 
      });
      openAIKeyForm.reset({ openaiApiKey: "" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update OpenAI API key",
        variant: "destructive",
      });
    },
  });

  const updateElevenLabsKeyMutation = useMutation({
    mutationFn: async (data: { elevenlabsApiKey?: string }) => {
      const payload: { elevenlabsApiKey?: string } = {};
      if (data.elevenlabsApiKey && data.elevenlabsApiKey.trim()) {
        payload.elevenlabsApiKey = data.elevenlabsApiKey.trim();
      }
      if (Object.keys(payload).length === 0) {
        throw new Error("Please enter an API key to update");
      }
      return apiRequest("PATCH", `/api/business-accounts/${selectedBusinessId}/api-settings`, payload);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "ElevenLabs API key updated successfully",
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/business-accounts", selectedBusinessId, "api-settings"] 
      });
      elevenLabsKeyForm.reset({ elevenlabsApiKey: "" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update ElevenLabs API key",
        variant: "destructive",
      });
    },
  });

  const updateCurrencyMutation = useMutation({
    mutationFn: async (data: CurrencyFormData) => {
      return apiRequest("PATCH", `/api/business-accounts/${selectedBusinessId}/api-settings`, data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Currency updated successfully",
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/business-accounts", selectedBusinessId, "api-settings"] 
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update currency",
        variant: "destructive",
      });
    },
  });

  const updateVistaSettingsMutation = useMutation({
    mutationFn: async (data: { provider?: string; googleApiKey?: string | null }) => {
      return apiRequest("PUT", `/api/business-accounts/${selectedBusinessId}/vista-settings`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", selectedBusinessId, "vista-settings"] });
      setGoogleApiKey('');
      toast({
        title: "Settings saved",
        description: "Vista Studio settings have been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update Vista settings",
        variant: "destructive",
      });
    },
  });

  const testGoogleApiKey = async () => {
    if (!googleApiKey) {
      toast({ title: "Please enter an API key", variant: "destructive" });
      return;
    }
    setIsTestingGoogleKey(true);
    try {
      const response = await fetch(`/api/business-accounts/${selectedBusinessId}/test-google-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ apiKey: googleApiKey })
      });
      const data = await response.json();
      if (data.success) {
        toast({ title: "API key is valid!", description: "You can now save this key." });
      } else {
        toast({ title: "Invalid API key", description: data.error || "Please check your key.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Test failed", description: "Could not verify the API key.", variant: "destructive" });
    } finally {
      setIsTestingGoogleKey(false);
    }
  };


  const handleOpenAIKeySubmit = openAIKeyForm.handleSubmit((data) => {
    if (!selectedBusinessId) {
      toast({
        title: "Error",
        description: "Please select a business account first",
        variant: "destructive",
      });
      return;
    }
    updateOpenAIKeyMutation.mutate({ openaiApiKey: data.openaiApiKey });
  });

  const handleElevenLabsKeySubmit = elevenLabsKeyForm.handleSubmit((data) => {
    if (!selectedBusinessId) {
      toast({
        title: "Error",
        description: "Please select a business account first",
        variant: "destructive",
      });
      return;
    }
    updateElevenLabsKeyMutation.mutate({ elevenlabsApiKey: data.elevenlabsApiKey });
  });

  const handleCurrencySubmit = currencyForm.handleSubmit((data) => {
    if (!selectedBusinessId) {
      toast({
        title: "Error",
        description: "Please select a business account first",
        variant: "destructive",
      });
      return;
    }
    updateCurrencyMutation.mutate(data);
  });

  return (
    <div className="max-w-3xl space-y-5">
      {selectedBusinessId && !apiSettingsLoading && apiSettings && (
        <>
          {section === "keys" && (<>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Key className="w-5 h-5" />
                OpenAI API Key
              </CardTitle>
              <CardDescription>
                Configure the OpenAI API key for this business account's chatbot
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {apiSettings?.hasOpenAIKey && (
                <div className="p-4 bg-muted rounded-md space-y-2">
                  <p className="text-sm font-medium">Current API Key</p>
                  <p className="text-sm font-mono text-muted-foreground">
                    {apiSettings.openaiApiKey}
                  </p>
                </div>
              )}

              <form onSubmit={handleOpenAIKeySubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="openaiApiKey">
                    {apiSettings?.hasOpenAIKey ? "New API Key (leave blank to keep existing)" : "API Key"}
                  </Label>
                  <div className="relative">
                    <Input
                      id="openaiApiKey"
                      type={showOpenAIKey ? "text" : "password"}
                      placeholder="sk-..."
                      data-testid="input-openai-api-key"
                      {...openAIKeyForm.register("openaiApiKey")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                      data-testid="button-toggle-openai-key-visibility"
                    >
                      {showOpenAIKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  {openAIKeyForm.formState.errors.openaiApiKey && (
                    <p className="text-sm text-destructive">
                      {openAIKeyForm.formState.errors.openaiApiKey.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={updateOpenAIKeyMutation.isPending || apiSettingsLoading}
                  data-testid="button-save-openai-key"
                >
                  {updateOpenAIKeyMutation.isPending ? "Saving..." : apiSettingsLoading ? "Loading..." : "Save API Key"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Key className="w-5 h-5" />
                ElevenLabs API Key
              </CardTitle>
              <CardDescription>
                Configure the ElevenLabs API key for premium TTS voices (optional)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {apiSettings?.hasElevenLabsKey && (
                <div className="p-4 bg-muted rounded-md space-y-2">
                  <p className="text-sm font-medium">Current API Key</p>
                  <p className="text-sm font-mono text-muted-foreground">
                    {apiSettings.elevenlabsApiKey}
                  </p>
                </div>
              )}

              <form onSubmit={handleElevenLabsKeySubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="elevenlabsApiKey">
                    {apiSettings?.hasElevenLabsKey ? "New API Key (leave blank to keep existing)" : "API Key"}
                  </Label>
                  <div className="relative">
                    <Input
                      id="elevenlabsApiKey"
                      type={showElevenLabsKey ? "text" : "password"}
                      placeholder="sk_..."
                      {...elevenLabsKeyForm.register("elevenlabsApiKey")}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowElevenLabsKey(!showElevenLabsKey)}
                    >
                      {showElevenLabsKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  {elevenLabsKeyForm.formState.errors.elevenlabsApiKey && (
                    <p className="text-sm text-destructive">
                      {elevenLabsKeyForm.formState.errors.elevenlabsApiKey.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={updateElevenLabsKeyMutation.isPending || apiSettingsLoading}
                >
                  {updateElevenLabsKeyMutation.isPending ? "Saving..." : apiSettingsLoading ? "Loading..." : "Save API Key"}
                </Button>
              </form>
            </CardContent>
          </Card>

          </>)}

          {section === "currency" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="w-5 h-5" />
                Currency
              </CardTitle>
              <CardDescription>
                Configure the display currency for products and pricing
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCurrencySubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Select
                    value={currencyForm.watch("currency")}
                    onValueChange={(value) => currencyForm.setValue("currency", value)}
                  >
                    <SelectTrigger data-testid="select-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {currencyForm.formState.errors.currency && (
                    <p className="text-sm text-destructive">
                      {currencyForm.formState.errors.currency.message}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={updateCurrencyMutation.isPending || apiSettingsLoading}
                  data-testid="button-save-currency"
                >
                  {updateCurrencyMutation.isPending ? "Saving..." : apiSettingsLoading ? "Loading..." : "Save Currency"}
                </Button>
              </form>
            </CardContent>
          </Card>
          )}

          {section === "keys" && (<>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Camera className="w-5 h-5" />
                Vista Studio
              </CardTitle>
              <CardDescription>
                Configure the AI model for product image generation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="text-sm font-medium mb-3 block">AI Image Provider</Label>
                <RadioGroup
                  value={vistaSettings?.provider || 'openai'}
                  onValueChange={(value) => updateVistaSettingsMutation.mutate({ provider: value })}
                  className="space-y-3"
                >
                  <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-gray-50">
                    <RadioGroupItem value="openai" id="openai" className="mt-0.5" />
                    <div className="flex-1">
                      <Label htmlFor="openai" className="cursor-pointer flex items-center gap-2">
                        <span className="font-medium">OpenAI DALL-E</span>
                        {vistaSettings?.hasOpenaiApiKey && (
                          <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Configured</span>
                        )}
                      </Label>
                      <p className="text-xs text-gray-500 mt-1">
                        Uses the configured OpenAI API key. No additional setup needed.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-gray-50">
                    <RadioGroupItem value="google" id="google" className="mt-0.5" />
                    <div className="flex-1">
                      <Label htmlFor="google" className="cursor-pointer flex items-center gap-2">
                        <span className="font-medium">Google Nano Banana Pro</span>
                        {vistaSettings?.hasGoogleApiKey && (
                          <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Key saved</span>
                        )}
                      </Label>
                      <p className="text-xs text-gray-500 mt-1">
                        Powered by Gemini 3 Pro Image. Requires a Google AI API key.
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>

              {vistaSettings?.provider === 'google' && (
                <div className="border-t pt-4">
                  <Label className="text-sm font-medium mb-2 block">Google AI API Key</Label>
                  <p className="text-xs text-gray-500 mb-3">
                    Get the API key from <a href="https://aistudio.google.com" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Google AI Studio</a>
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showGoogleApiKey ? 'text' : 'password'}
                        placeholder={vistaSettings?.hasGoogleApiKey ? '••••••••••••••••' : 'Enter Google AI API key'}
                        value={googleApiKey}
                        onChange={(e) => setGoogleApiKey(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                        onClick={() => setShowGoogleApiKey(!showGoogleApiKey)}
                      >
                        {showGoogleApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      onClick={testGoogleApiKey}
                      disabled={!googleApiKey || isTestingGoogleKey}
                    >
                      {isTestingGoogleKey ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                    </Button>
                    <Button
                      onClick={() => updateVistaSettingsMutation.mutate({ googleApiKey })}
                      disabled={!googleApiKey || updateVistaSettingsMutation.isPending}
                    >
                      {updateVistaSettingsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Key'}
                    </Button>
                  </div>
                  {vistaSettings?.hasGoogleApiKey && (
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        API key is saved and encrypted
                      </p>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-600 hover:bg-red-50 h-7 px-2"
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Delete Key
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Google API Key?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove the Google API key and switch Vista Studio back to using OpenAI DALL-E for image generation.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-red-500 hover:bg-red-600"
                              onClick={() => updateVistaSettingsMutation.mutate({ provider: 'openai', googleApiKey: null })}
                            >
                              Delete Key
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="w-5 h-5" />
                Photo search
              </CardTitle>
              <CardDescription>
                Gemini Embedding 2 fingerprints each product photo; Chroney's built-in matcher finds the closest
                products (each jewellery piece is cut out and matched within its type). The catalog is indexed automatically.
              </CardDescription>
            </CardHeader>
            <CardContent data-testid="section-gemini-photo-search">
              <GeminiAccountKeyEditor businessAccountId={selectedBusinessId} />
            </CardContent>
          </Card>
          </>)}
        </>
      )}

      {selectedBusinessId && apiSettingsLoading && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading settings...</p>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
