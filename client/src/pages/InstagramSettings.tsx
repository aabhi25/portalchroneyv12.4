import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Settings, Loader2, CheckCircle, XCircle, Eye, EyeOff } from "lucide-react";
import InstagramTabBar from "@/components/InstagramTabBar";

interface InstagramSettingsData {
  id: string;
  businessAccountId: string;
  igAccountId: string | null;
  igAccessToken: string | null;
  appSecret: string | null;
  webhookVerifyToken: string | null;
  autoReplyEnabled: string;
  webhookUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export default function InstagramSettings() {
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const [igAccountId, setIgAccountId] = useState("");
  const [igAccessToken, setIgAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [webhookVerifyToken, setWebhookVerifyToken] = useState("");
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);

  const { data: settings, isLoading } = useQuery<InstagramSettingsData>({
    queryKey: ["/api/instagram/settings"],
    queryFn: async () => {
      return await apiRequest("GET", "/api/instagram/settings");
    },
  });

  useEffect(() => {
    if (settings) {
      setIgAccountId(settings.igAccountId || "");
      setIgAccessToken(settings.igAccessToken || "");
      setAppSecret(settings.appSecret || "");
      setWebhookVerifyToken(settings.webhookVerifyToken || "");
      setAutoReplyEnabled(settings.autoReplyEnabled === "true");
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PUT", "/api/instagram/settings", {
        igAccountId,
        igAccessToken,
        appSecret,
        webhookVerifyToken,
        autoReplyEnabled: autoReplyEnabled ? "true" : "false",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instagram/settings"] });
      toast({ title: "Settings saved", description: "Instagram settings updated successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save settings", variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/instagram/test-connection");
    },
    onSuccess: (data: any) => {
      toast({
        title: "Connection successful",
        description: `Connected as: ${data.profile?.username || data.profile?.name || "Instagram Account"}`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Connection failed", description: error.message || "Could not connect to Instagram", variant: "destructive" });
    },
  });

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const webhookUrl = settings?.webhookUrl || `${window.location.origin}/api/instagram/webhook`;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <InstagramTabBar activeTab="" />

      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Webhook Configuration</CardTitle>
            <CardDescription>
              Use this URL in your Meta App's Instagram webhook settings. Set the callback URL and verify token below.
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
            <CardTitle>Instagram Account</CardTitle>
            <CardDescription>
              Enter your Instagram credentials from the Meta Developer Portal. Uses Instagram API with Instagram Login.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="igAccountId">Instagram Account ID</Label>
              <Input
                id="igAccountId"
                value={igAccountId}
                onChange={(e) => setIgAccountId(e.target.value)}
                placeholder="e.g. 17841400123456789"
              />
              <p className="text-xs text-muted-foreground">
                Your Instagram app-scoped user ID from the Meta Developer Portal.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="igAccessToken">Instagram Access Token</Label>
              <div className="flex gap-2">
                <Input
                  id="igAccessToken"
                  type={showToken ? "text" : "password"}
                  value={igAccessToken}
                  onChange={(e) => setIgAccessToken(e.target.value)}
                  placeholder="Enter your Instagram User Access Token"
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
                Long-lived Instagram User Access Token. Stored encrypted.
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
              When enabled, the AI agent will automatically reply to incoming Instagram DMs using your training data, FAQs, and custom instructions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable AI Auto-Reply</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically respond to Instagram DMs with AI-generated replies
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
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
            disabled={testMutation.isPending || !igAccessToken}
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
