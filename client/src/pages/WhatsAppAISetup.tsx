import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Loader2, Sparkles, Bot, Route, Layers,
  MessageSquare, FileText, Globe, ShoppingBag, HelpCircle,
} from "lucide-react";
import { AI_AGENT_TEMPLATES } from "@/lib/aiAgentTemplates";

type AiResponseMode = "smart_ai" | "guided_flows" | "both" | null;
type UseCaseMode = "lead_capture" | "direct_sales" | "customer_support";

interface AiSetupSettings {
  autoReplyEnabled: boolean;
  customPrompt: string | null;
  useCaseMode: UseCaseMode;
  aiResponseMode: AiResponseMode;
  useFaqKnowledge: boolean;
  useDocumentKnowledge: boolean;
  useWebsiteKnowledge: boolean;
  useProductCatalogKnowledge: boolean;
}

const RESPONSE_MODES: { value: Exclude<AiResponseMode, null>; title: string; desc: string; icon: typeof Bot }[] = [
  {
    value: "smart_ai",
    title: "Smart AI handles everything",
    desc: "The AI replies to every message on its own using your personality and knowledge. No scripted steps — best when you just want AI to take care of conversations.",
    icon: Bot,
  },
  {
    value: "guided_flows",
    title: "Guided Flows only",
    desc: "Replies follow the step-by-step flows you build in AI Flows. The AI only takes over when a flow explicitly hands off to it.",
    icon: Route,
  },
  {
    value: "both",
    title: "Both (recommended)",
    desc: "Your flows run first for the steps you've scripted, and Smart AI handles anything the flows don't cover.",
    icon: Layers,
  },
];

const GOALS: { value: UseCaseMode; title: string; desc: string }[] = [
  {
    value: "direct_sales",
    title: "Sell to prospects",
    desc: "The AI talks directly to potential customers, treats hesitation as a sales objection, and tries to re-engage rather than accepting the first \"no\".",
  },
  {
    value: "lead_capture",
    title: "Capture leads",
    desc: "Best when your own staff submit customer leads on WhatsApp. The AI is brisk and operational, focused on recording details accurately.",
  },
  {
    value: "customer_support",
    title: "Support customers",
    desc: "The AI helps existing customers with questions and issues. Empathetic and helpful, it never pushes sales and keeps troubleshooting.",
  },
];

const KNOWLEDGE_SOURCES: { key: keyof Pick<AiSetupSettings, "useFaqKnowledge" | "useDocumentKnowledge" | "useWebsiteKnowledge" | "useProductCatalogKnowledge">; title: string; desc: string; icon: typeof FileText }[] = [
  { key: "useFaqKnowledge", title: "FAQs", desc: "Use your saved FAQ answers to reply accurately.", icon: HelpCircle },
  { key: "useDocumentKnowledge", title: "Document training", desc: "Use knowledge extracted from your uploaded documents.", icon: FileText },
  { key: "useWebsiteKnowledge", title: "Website content", desc: "Use information analyzed from your website pages.", icon: Globe },
  { key: "useProductCatalogKnowledge", title: "Product catalog", desc: "Let the AI search and recommend products from your catalog.", icon: ShoppingBag },
];

export default function WhatsAppAISetup() {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [aiResponseMode, setAiResponseMode] = useState<AiResponseMode>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [useCaseMode, setUseCaseMode] = useState<UseCaseMode>("direct_sales");
  const [useFaqKnowledge, setUseFaqKnowledge] = useState(true);
  const [useDocumentKnowledge, setUseDocumentKnowledge] = useState(true);
  const [useWebsiteKnowledge, setUseWebsiteKnowledge] = useState(true);
  const [useProductCatalogKnowledge, setUseProductCatalogKnowledge] = useState(true);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/whatsapp/settings"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch WhatsApp settings");
      return res.json() as Promise<{ settings: AiSetupSettings }>;
    },
  });

  useEffect(() => {
    const s = data?.settings;
    if (!s) return;
    setAutoReplyEnabled(!!s.autoReplyEnabled);
    setAiResponseMode(s.aiResponseMode ?? null);
    setCustomPrompt(s.customPrompt ?? "");
    setUseCaseMode(s.useCaseMode ?? "direct_sales");
    setUseFaqKnowledge(s.useFaqKnowledge ?? true);
    setUseDocumentKnowledge(s.useDocumentKnowledge ?? true);
    setUseWebsiteKnowledge(s.useWebsiteKnowledge ?? true);
    setUseProductCatalogKnowledge(s.useProductCatalogKnowledge ?? true);
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (payload: Partial<AiSetupSettings>) => {
      const res = await fetch("/api/whatsapp/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save settings");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/settings"] });
    },
    onError: (err: Error) => {
      toast({ title: "Could not save", description: err.message, variant: "destructive" });
    },
  });

  const saveField = (payload: Partial<AiSetupSettings>) => mutation.mutate(payload);

  const handleSavePersona = () => {
    saveField({ customPrompt: customPrompt.trim() || null });
    toast({ title: "AI personality saved" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <p className="text-sm text-muted-foreground">
          WhatsApp is not enabled for this business, or settings could not be loaded.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            AI Setup
          </h1>
          <p className="text-sm text-muted-foreground">
            Set up how the AI replies on WhatsApp — all in one place.
          </p>
        </div>
      </div>

      {/* 1. Enable auto-reply */}
      <Card className="border-green-200 bg-green-50/30">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-green-600" />
                <h3 className="text-base font-semibold">Enable AI Auto-Reply</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                The master switch. When off, incoming messages are collected but the AI won't reply.
              </p>
            </div>
            <Switch
              checked={autoReplyEnabled}
              onCheckedChange={(checked) => {
                setAutoReplyEnabled(checked);
                saveField({ autoReplyEnabled: checked });
              }}
              data-testid="switch-auto-reply"
            />
          </div>
        </CardContent>
      </Card>

      {/* 2. Response mode */}
      <Card>
        <CardHeader>
          <CardTitle>How should AI respond?</CardTitle>
          <CardDescription>
            Choose whether the AI answers freely, follows your scripted flows, or does both.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {RESPONSE_MODES.map((opt) => {
            const Icon = opt.icon;
            const selected = aiResponseMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-testid={`button-response-mode-${opt.value}`}
                onClick={() => {
                  setAiResponseMode(opt.value);
                  saveField({ aiResponseMode: opt.value });
                }}
                className={`w-full text-left rounded-lg border p-4 transition ${
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${selected ? "text-primary" : "text-gray-400"}`} />
                  <div className="flex-1">
                    <div className="font-semibold text-sm text-gray-900">{opt.title}</div>
                    <div className="text-sm text-gray-600 mt-1">{opt.desc}</div>
                  </div>
                </div>
              </button>
            );
          })}
          {aiResponseMode !== "smart_ai" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/admin/whatsapp-flows")}
              data-testid="button-open-flows"
            >
              <Route className="h-4 w-4 mr-2" />
              Open AI Flows
            </Button>
          )}
        </CardContent>
      </Card>

      {/* 3. AI Personality */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            <CardTitle>AI Personality</CardTitle>
          </div>
          <CardDescription>
            Describe the AI's tone, style, and sales approach. Pick a template to start, then edit it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Quick Templates (click to load)</Label>
            <div className="grid grid-cols-2 gap-2">
              {AI_AGENT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.label}
                  type="button"
                  onClick={() => setCustomPrompt(tpl.prompt)}
                  className="text-left p-3 border rounded-md hover:border-purple-400 hover:bg-purple-50 transition-colors"
                  data-testid={`button-template-${tpl.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{tpl.icon}</span>
                    <span className="text-sm font-semibold text-gray-700">{tpl.label}</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-tight">{tpl.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="customPrompt">Agent Instructions</Label>
            <Textarea
              id="customPrompt"
              placeholder="Describe your AI agent's personality, tone, sales approach, and behavior. Pick a template above to get started, then customize it for your business."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={12}
              className="font-mono text-xs"
              data-testid="textarea-custom-prompt"
            />
            <div className="flex justify-between items-center">
              <p className="text-xs text-muted-foreground">
                Leave empty to let the AI run as a neutral, knowledge-based assistant.
              </p>
              {customPrompt && (
                <button
                  type="button"
                  onClick={() => setCustomPrompt("")}
                  className="text-xs text-gray-400 hover:text-red-500"
                  data-testid="button-clear-prompt"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t">
            <Button onClick={handleSavePersona} disabled={mutation.isPending} data-testid="button-save-persona">
              {mutation.isPending ? "Saving..." : "Save Personality"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 4. AI Goal */}
      <Card>
        <CardHeader>
          <CardTitle>AI Goal</CardTitle>
          <CardDescription>What should the AI try to achieve in conversations?</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {GOALS.map((opt) => {
            const selected = useCaseMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-testid={`button-goal-${opt.value}`}
                onClick={() => {
                  setUseCaseMode(opt.value);
                  saveField({ useCaseMode: opt.value });
                }}
                className={`w-full text-left rounded-lg border p-4 transition ${
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${
                      selected ? "border-primary bg-primary" : "border-gray-300 bg-white"
                    }`}
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-sm text-gray-900">{opt.title}</div>
                    <div className="text-sm text-gray-600 mt-1">{opt.desc}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {/* 5. Knowledge sources */}
      <Card>
        <CardHeader>
          <CardTitle>Knowledge Sources</CardTitle>
          <CardDescription>
            Choose which of your training data the AI uses before replying. Turn any off to exclude it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {KNOWLEDGE_SOURCES.map((src, idx) => {
            const Icon = src.icon;
            const valueMap: Record<string, boolean> = {
              useFaqKnowledge,
              useDocumentKnowledge,
              useWebsiteKnowledge,
              useProductCatalogKnowledge,
            };
            const setterMap: Record<string, (v: boolean) => void> = {
              useFaqKnowledge: setUseFaqKnowledge,
              useDocumentKnowledge: setUseDocumentKnowledge,
              useWebsiteKnowledge: setUseWebsiteKnowledge,
              useProductCatalogKnowledge: setUseProductCatalogKnowledge,
            };
            const checked = valueMap[src.key];
            return (
              <div
                key={src.key}
                className={`flex items-center justify-between gap-4 py-3 ${idx > 0 ? "border-t" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
                  <div>
                    <div className="font-medium text-sm text-gray-900">{src.title}</div>
                    <div className="text-sm text-muted-foreground">{src.desc}</div>
                  </div>
                </div>
                <Switch
                  checked={checked}
                  data-testid={`switch-${src.key}`}
                  onCheckedChange={(v) => {
                    setterMap[src.key](v);
                    saveField({ [src.key]: v } as Partial<AiSetupSettings>);
                  }}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
