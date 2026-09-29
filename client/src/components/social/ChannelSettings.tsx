import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Copy, Check, Settings, Loader2, CheckCircle, XCircle, Eye, EyeOff, ArrowLeft } from "lucide-react";
import InstagramTabBar from "@/components/InstagramTabBar";
import { SOCIAL_CHANNELS, type SocialChannel } from "./channelConfig";

interface ChannelSettingsData {
  id: string;
  businessAccountId: string;
  /** Instagram */
  igAccountId?: string | null;
  igAccessToken?: string | null;
  /** Facebook */
  pageId?: string | null;
  pageAccessToken?: string | null;
  leadCaptureEnabled?: string;
  appSecret: string | null;
  webhookVerifyToken: string | null;
  autoReplyEnabled: string;
  webhookUrl?: string;
  needsAppSecret?: boolean;
  webhookSignatureVerified?: boolean;
  webhookSignature?: { failingRecently?: boolean; lastFailureAt?: string };
  createdAt: string;
  updatedAt: string;
}

/** Per-channel copy for the account card and the credential fields. */
const ACCOUNT_COPY = {
  instagram: {
    accountFieldKey: "igAccountId",
    tokenFieldKey: "igAccessToken",
    cardTitle: "Instagram Account",
    cardDescription: "Enter your Instagram credentials from the Meta Developer Portal. Uses Instagram API with Instagram Login.",
    accountLabel: "Instagram Account ID",
    accountPlaceholder: "e.g. 17841400123456789",
    accountHelp: "Your Instagram app-scoped user ID from the Meta Developer Portal.",
    tokenLabel: "Instagram Access Token",
    tokenPlaceholder: "Enter your Instagram User Access Token",
    tokenHelp: "Long-lived Instagram User Access Token. Stored encrypted.",
    connectedFallback: "Instagram Account",
  },
  facebook: {
    accountFieldKey: "pageId",
    tokenFieldKey: "pageAccessToken",
    cardTitle: "Facebook Page",
    cardDescription: "Enter your Facebook Page credentials from the Meta Developer Portal.",
    accountLabel: "Page ID",
    accountPlaceholder: "e.g. 123456789012345",
    accountHelp: "Your Facebook Page ID from the Meta Developer Portal.",
    tokenLabel: "Page Access Token",
    tokenPlaceholder: "Enter your Facebook Page Access Token",
    tokenHelp: "Long-lived Page Access Token. Stored encrypted.",
    connectedFallback: "Facebook Page",
  },
} as const;

/** Connection + AI auto-reply settings for Instagram or Facebook. */
export default function ChannelSettings({ channel }: { channel: SocialChannel }) {
  const c = SOCIAL_CHANNELS[channel];
  const copy = ACCOUNT_COPY[channel];
  const settingsUrl = `${c.apiBase}/settings`;
  const isFacebook = channel === "facebook";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const [accountId, setAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [webhookVerifyToken, setWebhookVerifyToken] = useState("");
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [leadCaptureEnabled, setLeadCaptureEnabled] = useState(false);

  const { data: settings, isLoading } = useQuery<ChannelSettingsData>({
    queryKey: [settingsUrl],
    queryFn: async () => {
      return await apiRequest("GET", settingsUrl);
    },
  });

  useEffect(() => {
    if (settings) {
      setAccountId(settings[copy.accountFieldKey] || "");
      setAccessToken(settings[copy.tokenFieldKey] || "");
      setAppSecret(settings.appSecret || "");
      setWebhookVerifyToken(settings.webhookVerifyToken || "");
      setAutoReplyEnabled(settings.autoReplyEnabled === "true");
      if (isFacebook) setLeadCaptureEnabled(settings.leadCaptureEnabled === "true");
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PUT", settingsUrl, {
        [copy.accountFieldKey]: accountId,
        [copy.tokenFieldKey]: accessToken,
        appSecret,
        webhookVerifyToken,
        autoReplyEnabled: autoReplyEnabled ? "true" : "false",
        // Instagram lead capture is switched on the Leads page.
        ...(isFacebook ? { leadCaptureEnabled: leadCaptureEnabled ? "true" : "false" } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [settingsUrl] });
      toast({ title: "Settings saved", description: `${c.label} settings updated successfully.` });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save settings", variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `${c.apiBase}/test-connection`);
    },
    onSuccess: (data: any) => {
      const who = isFacebook
        ? data.profile?.name || data.page?.name
        : data.profile?.username || data.profile?.name;
      toast({
        title: "Connection successful",
        description: `Connected as: ${who || copy.connectedFallback}`,
      });
    },
    onError: (error: any) => {
      toast({ title: "Connection failed", description: error.message || `Could not connect to ${c.label}`, variant: "destructive" });
    },
  });

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const webhookUrl = settings?.webhookUrl || `${window.location.origin}${c.apiBase}/webhook`;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={c.usesTabBar ? "min-h-screen bg-gray-50" : "flex flex-col h-full"}>
      {c.usesTabBar ? (
        <InstagramTabBar activeTab="" />
      ) : (
        <header className="sticky top-0 z-50 flex items-center gap-4 border-b bg-background px-4 h-14 shrink-0">
          <SidebarTrigger />
          <Button variant="ghost" size="sm" onClick={() => setLocation(c.homePath)} className="gap-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-500" />
            <h1 className="text-lg font-semibold">{c.label} AI Agent Settings</h1>
          </div>
        </header>
      )}

      <div className={c.usesTabBar ? "p-6 space-y-6" : "flex-1 overflow-y-auto p-4 md:p-6 space-y-6 max-w-3xl"}>
        <Card>
          <CardHeader>
            <CardTitle>Webhook Configuration</CardTitle>
            <CardDescription>
              Use this URL in your Meta App's {c.label} webhook settings. Set the callback URL and verify token below.
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
            <CardTitle>{copy.cardTitle}</CardTitle>
            <CardDescription>
              {copy.cardDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={copy.accountFieldKey}>{copy.accountLabel}</Label>
              <Input
                id={copy.accountFieldKey}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder={copy.accountPlaceholder}
              />
              <p className="text-xs text-muted-foreground">
                {copy.accountHelp}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={copy.tokenFieldKey}>{copy.tokenLabel}</Label>
              <div className="flex gap-2">
                <Input
                  id={copy.tokenFieldKey}
                  type={showToken ? "text" : "password"}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={copy.tokenPlaceholder}
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
                {copy.tokenHelp}
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
              {settings?.needsAppSecret && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" data-testid="warning-app-secret-missing">
                  <strong>App Secret missing:</strong> incoming {c.label} webhooks are not being verified, so forged messages cannot be told apart from real ones. Find it in the Meta App Dashboard &rarr; Settings &rarr; Basic &rarr; App Secret, paste it above and save.
                </div>
              )}
              {!settings?.needsAppSecret && settings?.webhookSignature?.failingRecently && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200" data-testid="warning-app-secret-mismatch">
                  <strong>Webhook signature check failing:</strong> recent webhooks were rejected because their signature did not match the saved App Secret. Check the value in the Meta App Dashboard &rarr; Settings &rarr; Basic &rarr; App Secret (for the same app your {c.label} webhook is subscribed through).
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Auto-Reply</CardTitle>
            <CardDescription>
              When enabled, the AI agent will automatically reply to incoming {isFacebook ? "Facebook Messenger messages" : "Instagram DMs"} using your training data, FAQs, and custom instructions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable AI Auto-Reply</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically respond to {isFacebook ? "Facebook Messenger messages" : "Instagram DMs"} with AI-generated replies
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
              />
            </div>
          </CardContent>
        </Card>

        {isFacebook && (
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
        )}

        <div className="flex gap-3">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className={c.theme.settingsSaveButton}
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
            disabled={testMutation.isPending || !accessToken}
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
