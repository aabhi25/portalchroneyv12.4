import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Settings, Loader2, CheckCircle, XCircle, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useLocation } from "wouter";

interface FacebookSettingsData {
  id: string;
  businessAccountId: string;
  pageId: string | null;
  pageAccessToken: string | null;
  appSecret: string | null;
  webhookVerifyToken: string | null;
  autoReplyEnabled: string;
  leadCaptureEnabled: string;
  webhookUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export default function FacebookSettings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const [pageId, setPageId] = useState("");
  const [pageAccessToken, setPageAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [webhookVerifyToken, setWebhookVerifyToken] = useState("");
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [leadCaptureEnabled, setLeadCaptureEnabled] = useState(false);

  const { data: settings, isLoading } = useQuery<FacebookSettingsData>({
    queryKey: ["/api/facebook/settings"],
    queryFn: async () => {
      return await apiRequest("GET", "/api/facebook/settings");
    },
  });

  useEffect(() => {
    if (settings) {
      setPageId(settings.pageId || "");
      setPageAccessToken(settings.pageAccessToken || "");
      setAppSecret(settings.appSecret || "");
      setWebhookVerifyToken(settings.webhookVerifyToken || "");
      setAutoReplyEnabled(settings.autoReplyEnabled === "true");
      setLeadCaptureEnabled(settings.leadCaptureEnabled === "true");
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PUT", "/api/facebook/settings", {
        pageId,
        pageAccessToken,
        appSecret,
        webhookVerifyToken,
        autoReplyEnabled: autoReplyEnabled ? "true" : "false",
        leadCaptureEnabled: leadCaptureEnabled ? "true" : "false",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/facebook/settings"] });
      toast({ title: "Settings saved", description: "Facebook settings updated successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save settings", variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/facebook/test-connection");
    },
    onSuccess: (data: any) => {
      toast({
        title: "Connection successful",
        description: `Connected as: ${data.profile?.name || data.page?.name || "Facebook Page"}`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Connection failed", description: error.message || "Could not connect to Facebook", variant: "destructive" });
    },
  });

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const webhookUrl = settings?.webhookUrl || `${window.location.origin}/api/facebook/webhook`;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-50 flex items-center gap-4 border-b bg-background px-4 h-14 shrink-0">
        <SidebarTrigger />
        <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/facebook")} className="gap-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-blue-500" />
          <h1 className="text-lg font-semibold">Facebook AI Agent Settings</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Webhook Configuration</CardTitle>
            <CardDescription>
              Use this URL in your Meta App's Facebook webhook settings. Set the callback URL and verify token below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Webhook Callback URL</Label>
              <div className="flex gap-2">
                <Input value={webhookUrl} readOnly className="font-mono text-sm bg-muted" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(webhookUrl, "webhook")}
                >
                  {copiedField === "webhook" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhookVerifyToken">Webhook Verify Token</Label>
              <div className="flex gap-2">
                <Input
                  id="webhookVerifyToken"
                  value={webhookVerifyToken}
                  onChange={(e) => setWebhookVerifyToken(e.target.value)}
                  placeholder="Enter a custom verify token"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    const token = crypto.randomUUID();
                    setWebhookVerifyToken(token);
                  }}
                  title="Generate random token"
                >
                  <Settings className="w-4 h-4" />
                </Button>
                {webhookVerifyToken && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(webhookVerifyToken, "verifyToken")}
                  >
                    {copiedField === "verifyToken" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                This token must match the one you enter in your Meta App webhook configuration.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Facebook Page</CardTitle>
            <CardDescription>
              Enter your Facebook Page credentials from the Meta Developer Portal.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pageId">Page ID</Label>
              <Input
                id="pageId"
                value={pageId}
                onChange={(e) => setPageId(e.target.value)}
                placeholder="e.g. 123456789012345"
              />
              <p className="text-xs text-muted-foreground">
                Your Facebook Page ID from the Meta Developer Portal.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pageAccessToken">Page Access Token</Label>
              <div className="flex gap-2">
                <Input
                  id="pageAccessToken"
                  type={showToken ? "text" : "password"}
                  value={pageAccessToken}
                  onChange={(e) => setPageAccessToken(e.target.value)}
                  placeholder="Enter your Facebook Page Access Token"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Long-lived Page Access Token. Stored encrypted.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="appSecret">App Secret</Label>
              <div className="flex gap-2">
                <Input
                  id="appSecret"
                  type={showSecret ? "text" : "password"}
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder="Enter your Meta App Secret"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSecret(!showSecret)}
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Used to verify webhook signatures. Stored encrypted.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Auto-Reply</CardTitle>
            <CardDescription>
              When enabled, the AI agent will automatically reply to incoming Facebook Messenger messages using your training data, FAQs, and custom instructions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable AI Auto-Reply</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically respond to Facebook Messenger messages with AI-generated replies
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lead Capture</CardTitle>
            <CardDescription>
              Automatically capture leads from Facebook Messenger conversations and store them in your CRM.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Lead Capture</Label>
                <p className="text-xs text-muted-foreground">
                  Capture contact details and conversation data as leads from Facebook messages
                </p>
              </div>
              <Switch
                checked={leadCaptureEnabled}
                onCheckedChange={setLeadCaptureEnabled}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Settings"
            )}
          </Button>

          <Button
            variant="outline"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || !pageAccessToken}
          >
            {testMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : testMutation.isSuccess ? (
              <>
                <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
                Connected
              </>
            ) : testMutation.isError ? (
              <>
                <XCircle className="w-4 h-4 mr-2 text-red-500" />
                Failed
              </>
            ) : (
              "Test Connection"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}