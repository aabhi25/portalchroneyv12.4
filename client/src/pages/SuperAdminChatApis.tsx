import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Eye, EyeOff, Save, Bot, Zap, AlertCircle, CheckCircle2, ArrowUpDown, ChevronsUpDown, Check, Loader2, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";

const OPENAI_MODELS = [
  { value: "gpt-5.2", label: "GPT-5.2 (Flagship)", group: "GPT-5 Family" },
  { value: "gpt-5.1", label: "GPT-5.1", group: "GPT-5 Family" },
  { value: "gpt-5", label: "GPT-5", group: "GPT-5 Family" },
  { value: "gpt-5-mini", label: "GPT-5 Mini", group: "GPT-5 Family" },
  { value: "o4-mini", label: "o4-mini (Reasoning)", group: "Reasoning (o-series)" },
  { value: "o3", label: "o3 (Reasoning)", group: "Reasoning (o-series)" },
  { value: "o3-mini", label: "o3-mini (Reasoning)", group: "Reasoning (o-series)" },
  { value: "o1", label: "o1 (Reasoning)", group: "Reasoning (o-series)" },
  { value: "gpt-4.5", label: "GPT-4.5", group: "GPT-4 Family" },
  { value: "gpt-4.1", label: "GPT-4.1", group: "GPT-4 Family" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", group: "GPT-4 Family" },
  { value: "gpt-4o", label: "GPT-4o", group: "GPT-4 Family" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini (Recommended)", group: "GPT-4 Family" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", group: "Legacy" },
];

const GEMINI_MODELS = [
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)", group: "Gemini 3" },
  { value: "gemini-3-pro", label: "Gemini 3 Pro", group: "Gemini 3" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)", group: "Gemini 3" },
  { value: "gemini-3-deep-think", label: "Gemini 3 Deep Think", group: "Gemini 3" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", group: "Gemini 2.5" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Recommended)", group: "Gemini 2.5" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", group: "Gemini 2.5" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash ⚠ retiring 3/31", group: "Gemini 2.0" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite ⚠ retiring 3/31", group: "Gemini 2.0" },
];

interface MasterAiSettings {
  primaryProvider: string;
  primaryApiKey: string | null;
  primaryModel: string;
  fallbackProvider: string;
  fallbackApiKey: string | null;
  fallbackModel: string;
  masterEnabled: boolean;
  fallbackEnabled: boolean;
  hasPrimaryKey: boolean;
  hasFallbackKey: boolean;
}

function ModelCombobox({
  value,
  models,
  onChange,
}: {
  value: string;
  models: { value: string; label: string; group: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const groups = Array.from(new Set(models.map((m) => m.group)));
  const filtered = search
    ? models.filter(
        (m) =>
          m.label.toLowerCase().includes(search.toLowerCase()) ||
          m.value.toLowerCase().includes(search.toLowerCase())
      )
    : models;

  const selectedLabel = models.find((m) => m.value === value)?.label ?? value;
  const isCustom = value && !models.find((m) => m.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selectedLabel || "Select model..."}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search or type a model name..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {search && !filtered.length ? (
              <CommandEmpty>
                <div className="p-2 text-center">
                  <p className="text-sm text-muted-foreground mb-2">No match in list</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      onChange(search.trim());
                      setSearch("");
                      setOpen(false);
                    }}
                  >
                    Use &ldquo;{search.trim()}&rdquo;
                  </Button>
                </div>
              </CommandEmpty>
            ) : (
              <>
                {(search
                  ? [{ name: "Results", items: filtered }]
                  : groups.map((g) => ({
                      name: g,
                      items: models.filter((m) => m.group === g),
                    }))
                ).map(({ name, items }) => (
                  <CommandGroup key={name} heading={name}>
                    {items.map((m) => (
                      <CommandItem
                        key={m.value}
                        value={m.value}
                        onSelect={() => {
                          onChange(m.value);
                          setSearch("");
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value === m.value ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {m.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
                {isCustom && (
                  <CommandGroup heading="Current (custom)">
                    <CommandItem value={value} onSelect={() => { setOpen(false); }}>
                      <Check className="mr-2 h-4 w-4 opacity-100" />
                      {value}
                    </CommandItem>
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface TestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

function ProviderSection({
  title,
  description,
  provider,
  apiKey,
  model,
  hasKey,
  onProviderChange,
  onApiKeyChange,
  onModelChange,
  onSave,
  isSaving,
  onTest,
  isTesting,
  testResult,
  icon,
}: {
  title: string;
  description: string;
  provider: string;
  apiKey: string;
  model: string;
  hasKey: boolean;
  onProviderChange: (v: string) => void;
  onApiKeyChange: (v: string) => void;
  onModelChange: (v: string) => void;
  onSave: () => void;
  isSaving: boolean;
  onTest: () => void;
  isTesting: boolean;
  testResult: TestResult | null;
  icon: React.ReactNode;
}) {
  const [showKey, setShowKey] = useState(false);
  const [isEditingKey, setIsEditingKey] = useState(false);
  const models = provider === "gemini" ? GEMINI_MODELS : OPENAI_MODELS;

  const showingDots = hasKey && !isEditingKey && !apiKey;
  const canTest = hasKey || apiKey.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Provider</Label>
          <Select value={provider} onValueChange={onProviderChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI (ChatGPT)</SelectItem>
              <SelectItem value="gemini">Google Gemini</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>API Key</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? "text" : "password"}
                value={showingDots ? "••••••••••••••••••••••••••••••••" : apiKey}
                readOnly={showingDots}
                onChange={(e) => onApiKeyChange(e.target.value)}
                onFocus={() => {
                  if (hasKey && !apiKey) {
                    setIsEditingKey(true);
                  }
                }}
                onBlur={() => {
                  if (!apiKey) setIsEditingKey(false);
                }}
                placeholder={provider === "gemini" ? "AIza..." : "sk-..."}
                className={`pr-10 ${showingDots ? "cursor-pointer" : ""}`}
              />
              <button
                type="button"
                onClick={() => {
                  if (showingDots) {
                    setIsEditingKey(true);
                  } else {
                    setShowKey(!showKey);
                  }
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showingDots ? <Eye className="w-4 h-4" /> : showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {hasKey && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-green-500" />
              {isEditingKey || apiKey ? "Saving will replace the existing key" : "Key configured — click to replace"}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onTest}
              disabled={isTesting || !canTest}
              className="gap-2"
            >
              {isTesting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wifi className="w-3.5 h-3.5" />
              )}
              {isTesting ? "Testing..." : "Test Connection"}
            </Button>
            {testResult && (
              <span
                className={cn(
                  "text-xs flex items-center gap-1 px-2 py-1 rounded-full font-medium",
                  testResult.success
                    ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                    : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                )}
              >
                {testResult.success ? (
                  <>
                    <CheckCircle2 className="w-3 h-3" />
                    Connected{testResult.latencyMs !== undefined ? ` (${testResult.latencyMs}ms)` : ""}
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3 h-3" />
                    {testResult.message}
                  </>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Model</Label>
          <ModelCombobox value={model} models={models} onChange={onModelChange} />
        </div>

        <Button onClick={onSave} disabled={isSaving} className="w-full">
          {isSaving ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin">⟳</span> Saving...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Save className="w-4 h-4" /> Save {title}
            </span>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SuperAdminChatApis() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<MasterAiSettings>({
    queryKey: ["/api/super-admin/master-ai-settings"],
    queryFn: () => apiRequest<MasterAiSettings>("GET", "/api/super-admin/master-ai-settings"),
  });

  const [primaryProvider, setPrimaryProvider] = useState<string>("");
  const [primaryApiKey, setPrimaryApiKey] = useState("");
  const [primaryModel, setPrimaryModel] = useState<string>("");
  const [fallbackProvider, setFallbackProvider] = useState<string>("");
  const [fallbackApiKey, setFallbackApiKey] = useState("");
  const [fallbackModel, setFallbackModel] = useState<string>("");
  const [masterEnabled, setMasterEnabled] = useState(false);
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [savingPrimary, setSavingPrimary] = useState(false);
  const [savingFallback, setSavingFallback] = useState(false);
  const [savingToggles, setSavingToggles] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [testingPrimary, setTestingPrimary] = useState(false);
  const [testingFallback, setTestingFallback] = useState(false);
  const [testResultPrimary, setTestResultPrimary] = useState<TestResult | null>(null);
  const [testResultFallback, setTestResultFallback] = useState<TestResult | null>(null);

  const effectivePrimaryProvider = primaryProvider || settings?.primaryProvider || "openai";
  const effectivePrimaryModel = primaryModel || settings?.primaryModel || "gpt-4o-mini";
  const effectiveFallbackProvider = fallbackProvider || settings?.fallbackProvider || "gemini";
  const effectiveFallbackModel = fallbackModel || settings?.fallbackModel || "gemini-2.5-flash";
  const effectiveMasterEnabled = primaryProvider ? masterEnabled : (settings?.masterEnabled ?? false);
  const effectiveFallbackEnabled = primaryProvider ? fallbackEnabled : (settings?.fallbackEnabled ?? true);

  const save = async (payload: Partial<MasterAiSettings & { primaryApiKey?: string; fallbackApiKey?: string }>) => {
    const data = await apiRequest<MasterAiSettings>("PUT", "/api/super-admin/master-ai-settings", payload);
    queryClient.invalidateQueries({ queryKey: ["/api/super-admin/master-ai-settings"] });
    return data;
  };

  const handleSavePrimary = async () => {
    setSavingPrimary(true);
    try {
      await save({
        primaryProvider: effectivePrimaryProvider,
        primaryModel: effectivePrimaryModel,
        ...(primaryApiKey ? { primaryApiKey } : {}),
      });
      setPrimaryApiKey("");
      toast({ title: "Primary provider saved" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingPrimary(false);
    }
  };

  const handleSaveFallback = async () => {
    setSavingFallback(true);
    try {
      await save({
        fallbackProvider: effectiveFallbackProvider,
        fallbackModel: effectiveFallbackModel,
        ...(fallbackApiKey ? { fallbackApiKey } : {}),
      });
      setFallbackApiKey("");
      toast({ title: "Fallback provider saved" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingFallback(false);
    }
  };

  const handleToggle = async (key: "masterEnabled" | "fallbackEnabled", value: boolean) => {
    setSavingToggles(true);
    try {
      await save({ [key]: value });
      if (key === "masterEnabled") setMasterEnabled(value);
      else setFallbackEnabled(value);
      toast({ title: value ? "Enabled" : "Disabled", description: key === "masterEnabled" ? "Master keys are now " + (value ? "active" : "inactive") : "Fallback is now " + (value ? "active" : "inactive") });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSavingToggles(false);
    }
  };

  const handleSwap = async () => {
    setIsSwapping(true);
    try {
      await apiRequest("POST", "/api/super-admin/master-ai-settings/swap");
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/master-ai-settings"] });
      setPrimaryProvider("");
      setPrimaryModel("");
      setFallbackProvider("");
      setFallbackModel("");
      toast({ title: "Providers swapped", description: "Primary and fallback have been exchanged." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsSwapping(false);
    }
  };

  const handleTest = async (side: "primary" | "fallback") => {
    const isPrimary = side === "primary";
    const setTesting = isPrimary ? setTestingPrimary : setTestingFallback;
    const setResult = isPrimary ? setTestResultPrimary : setTestResultFallback;
    const provider = isPrimary ? effectivePrimaryProvider : effectiveFallbackProvider;
    const model = isPrimary ? effectivePrimaryModel : effectiveFallbackModel;
    const newKey = isPrimary ? primaryApiKey : fallbackApiKey;

    setTesting(true);
    setResult(null);
    try {
      const result = await apiRequest<TestResult>("POST", "/api/super-admin/master-ai-settings/test", {
        provider,
        side,
        model,
        ...(newKey ? { apiKey: newKey } : {}),
      });
      setResult(result);
      setTimeout(() => setResult(null), 8000);
    } catch (e: any) {
      setResult({ success: false, message: e.message || "Request failed" });
      setTimeout(() => setResult(null), 8000);
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const activeMaster = settings?.masterEnabled;
  const hasPrimary = settings?.hasPrimaryKey;
  const hasFallback = settings?.hasFallbackKey;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="w-6 h-6" />
          Chat APIs
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure master AI provider keys that override individual business account settings. When enabled, all chats use these keys.
        </p>
      </div>

      {activeMaster && hasPrimary ? (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg text-sm">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          <span className="text-green-800 dark:text-green-200 font-medium">
            Master keys active — Primary: {settings.primaryProvider === "gemini" ? "Google Gemini" : "OpenAI"} ({settings.primaryModel})
            {settings.fallbackEnabled && hasFallback && (
              <> | Fallback: {settings.fallbackProvider === "gemini" ? "Google Gemini" : "OpenAI"} ({settings.fallbackModel})</>
            )}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 dark:text-amber-200">
            {!hasPrimary ? "No master key configured — using individual business account keys" : "Master keys configured but not enabled — toggle below to activate"}
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Master Control</CardTitle>
          <CardDescription>Toggle global override and fallback behavior</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Enable Master Keys</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                When on, all business accounts use the primary key below instead of their own keys
              </p>
            </div>
            <Switch
              checked={effectiveMasterEnabled}
              onCheckedChange={(v) => handleToggle("masterEnabled", v)}
              disabled={savingToggles || !hasPrimary}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Enable Fallback</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                If the primary provider fails (auth error, quota exceeded), automatically retry with the fallback provider
              </p>
            </div>
            <Switch
              checked={effectiveFallbackEnabled}
              onCheckedChange={(v) => handleToggle("fallbackEnabled", v)}
              disabled={savingToggles}
            />
          </div>
        </CardContent>
      </Card>

      <ProviderSection
        title="Primary Provider"
        description="Main AI provider used for all chat responses"
        provider={effectivePrimaryProvider}
        apiKey={primaryApiKey}
        model={effectivePrimaryModel}
        hasKey={!!settings?.hasPrimaryKey}
        onProviderChange={(v) => {
          setPrimaryProvider(v);
          const defaultModel = v === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini";
          setPrimaryModel(defaultModel);
        }}
        onApiKeyChange={setPrimaryApiKey}
        onModelChange={setPrimaryModel}
        onSave={handleSavePrimary}
        isSaving={savingPrimary}
        onTest={() => handleTest("primary")}
        isTesting={testingPrimary}
        testResult={testResultPrimary}
        icon={<Zap className="w-5 h-5 text-blue-500" />}
      />

      <div className="flex items-center justify-center">
        <Button
          variant="outline"
          onClick={handleSwap}
          disabled={isSwapping || (!settings?.hasPrimaryKey && !settings?.hasFallbackKey)}
          className="gap-2 text-sm"
        >
          <ArrowUpDown className={`w-4 h-4 ${isSwapping ? "animate-spin" : ""}`} />
          {isSwapping ? "Swapping..." : "Swap Primary ↔ Fallback"}
        </Button>
      </div>

      <ProviderSection
        title="Fallback Provider"
        description="Used automatically if the primary provider fails"
        provider={effectiveFallbackProvider}
        apiKey={fallbackApiKey}
        model={effectiveFallbackModel}
        hasKey={!!settings?.hasFallbackKey}
        onProviderChange={(v) => {
          setFallbackProvider(v);
          const defaultModel = v === "gemini" ? "gemini-2.5-flash" : "gpt-4o-mini";
          setFallbackModel(defaultModel);
        }}
        onApiKeyChange={setFallbackApiKey}
        onModelChange={setFallbackModel}
        onSave={handleSaveFallback}
        isSaving={savingFallback}
        onTest={() => handleTest("fallback")}
        isTesting={testingFallback}
        testResult={testResultFallback}
        icon={<Bot className="w-5 h-5 text-purple-500" />}
      />
    </div>
  );
}
