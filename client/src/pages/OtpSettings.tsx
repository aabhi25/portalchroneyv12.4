import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  EyeOff,
  KeyRound,
  Send,
  MessageSquare,
  Info,
} from "lucide-react";

type OtpChannel = "sms" | "whatsapp";
type OtpChannelPreference = "sms" | "whatsapp" | "both";

interface OtpSettingsResponse {
  provider: string;
  hasAuthKey: boolean;
  authKeyMasked: string;
  senderId: string;
  templateId: string;
  otpTemplateBody: string;
  businessConfigured: boolean;
  envFallbackConfigured: boolean;
  effectivelyConfigured: boolean;
  // Task #3
  whatsappOtpTemplateName: string;
  otpChannelPreference: OtpChannelPreference;
  whatsappBusinessConfigured: boolean;
  whatsappEffectivelyConfigured: boolean;
  availableChannels: OtpChannel[];
  updatedAt: string | null;
}

interface TestSendResponse {
  ok: boolean;
  phoneMasked: string;
  providerName: string;
  deliveryChannel?: OtpChannel;
  providerMessageId?: string;
  error?: string;
}

const DEFAULT_TEMPLATE_BODY =
  "Your verification code is {{otp}}. It expires in 5 minutes. Please do not share this code with anyone.";

export default function OtpSettings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [settings, setSettings] = useState<OtpSettingsResponse | null>(null);

  const [authKey, setAuthKey] = useState("");
  const [authKeyChanged, setAuthKeyChanged] = useState(false);
  const [showAuthKey, setShowAuthKey] = useState(false);
  const [senderId, setSenderId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [otpTemplateBody, setOtpTemplateBody] = useState("");
  // Task #3: channel preference + WhatsApp template name
  const [channelPreference, setChannelPreference] = useState<OtpChannelPreference>("sms");
  const [whatsappTemplateName, setWhatsappTemplateName] = useState("");

  const [testPhone, setTestPhone] = useState("");
  const [testChannel, setTestChannel] = useState<OtpChannel>("sms");
  const [testResult, setTestResult] = useState<TestSendResponse | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/otp-settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load settings");
      const data: OtpSettingsResponse = await res.json();
      setSettings(data);
      setSenderId(data.senderId || "");
      setTemplateId(data.templateId || "");
      setOtpTemplateBody(data.otpTemplateBody || DEFAULT_TEMPLATE_BODY);
      setChannelPreference((data.otpChannelPreference as OtpChannelPreference) || "sms");
      setWhatsappTemplateName(data.whatsappOtpTemplateName || "");
      setAuthKey("");
      setAuthKeyChanged(false);
      // Pick a sensible default test channel: prefer SMS, fall back to WhatsApp
      // only when SMS isn't available — so the test panel never sends to a
      // channel the admin can't actually use.
      const channels = data.availableChannels || [];
      if (channels.includes("sms")) setTestChannel("sms");
      else if (channels.includes("whatsapp")) setTestChannel("whatsapp");
    } catch (err: any) {
      toast({ title: "Couldn't load settings", description: err?.message || "Network error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        senderId,
        templateId,
        otpTemplateBody,
        whatsappOtpTemplateName: whatsappTemplateName,
        otpChannelPreference: channelPreference,
      };
      if (authKeyChanged && authKey.trim()) {
        payload.authKey = authKey.trim();
      }
      const res = await fetch("/api/admin/otp-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "Failed to save");
      }
      toast({ title: "Settings saved", description: "OTP / SMS settings updated." });
      fetchSettings();
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message || "Network error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async () => {
    setTestResult(null);
    if (!testPhone.trim()) {
      toast({ title: "Enter a phone number", description: "Provide a number to send a test code to.", variant: "destructive" });
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/admin/otp-settings/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone: testPhone.trim(), channel: testChannel }),
      });
      const data: TestSendResponse = await res.json();
      setTestResult(data);
      if (data.ok) {
        toast({
          title: "Test code sent",
          description: `Delivered to ${data.phoneMasked} via ${data.deliveryChannel === "whatsapp" ? "WhatsApp" : "SMS"}`,
        });
      } else {
        toast({ title: "Test send failed", description: data.error || "Provider returned an error", variant: "destructive" });
      }
    } catch (err: any) {
      setTestResult({ ok: false, phoneMasked: "", providerName: testChannel, deliveryChannel: testChannel, error: err?.message || "Network error" });
      toast({ title: "Test send failed", description: err?.message || "Network error", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const previewBody = (otpTemplateBody || "").replace(/\{\{\s*otp\s*\}\}/gi, "123456");

  return (
    <div className="container mx-auto py-6 px-4 max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/train-chroney")}
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">OTP / SMS settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure MSG91 credentials and the OTP message your visitors receive.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Status banner */}
          {settings && !settings.businessConfigured && (
            <Alert
              data-testid="alert-credentials-status"
              className={
                settings.envFallbackConfigured
                  ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
                  : "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20"
              }
            >
              <Info className="w-4 h-4" />
              <AlertDescription>
                {settings.envFallbackConfigured ? (
                  <>
                    Your business hasn't saved its own MSG91 credentials yet. OTP sends are
                    currently using the platform default sender. Save your own credentials
                    below to use your brand's DLT-approved sender.
                  </>
                ) : (
                  <>
                    MSG91 is not configured. Until you save valid credentials below, the
                    chatbot's OTP verification will fail to deliver SMS.
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
          {settings?.businessConfigured && (
            <Alert
              data-testid="alert-credentials-status"
              className="border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
            >
              <CheckCircle2 className="w-4 h-4" />
              <AlertDescription>
                MSG91 credentials saved for this business. OTP messages are sent via your
                own DLT-approved sender.
              </AlertDescription>
            </Alert>
          )}

          {/* Task #3: Delivery channel preference card. Lets the admin pick
              whether OTPs go out via SMS only, WhatsApp only, or both (with
              the visitor choosing at the widget). Validation prevents picking
              a channel that has no working sender configured. */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Send className="w-5 h-5 text-indigo-600" />
                Delivery channel
              </CardTitle>
              <CardDescription>
                Choose how visitors receive their verification code. Both channels use
                MSG91 — SMS uses your DLT-approved sender, WhatsApp uses an approved
                authentication-category template on your WhatsApp Cloud number.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(["sms", "whatsapp", "both"] as const).map((opt) => {
                const id = `channel-${opt}`;
                const label =
                  opt === "sms" ? "SMS only" : opt === "whatsapp" ? "WhatsApp only" : "Both — let the visitor pick";
                const helper =
                  opt === "sms"
                    ? "Standard one-time-password SMS via MSG91."
                    : opt === "whatsapp"
                      ? "Code arrives in WhatsApp from your Cloud API number. Requires an approved authentication template."
                      : "Widget shows an SMS/WhatsApp toggle in the phone-entry modal.";
                const disabledReason =
                  opt === "whatsapp" && !settings?.whatsappEffectivelyConfigured
                    ? "Configure your WhatsApp OTP template below first."
                    : opt === "sms" && !settings?.effectivelyConfigured
                      ? "Configure MSG91 credentials above first."
                      : opt === "both" &&
                        (!settings?.effectivelyConfigured || !settings?.whatsappEffectivelyConfigured)
                        ? "Configure both SMS (above) and WhatsApp (below) to enable visitor choice."
                        : null;
                return (
                  <label
                    key={opt}
                    htmlFor={id}
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                      channelPreference === opt
                        ? "border-indigo-400 bg-indigo-50/60 dark:border-indigo-700 dark:bg-indigo-950/20"
                        : "border-gray-200 dark:border-gray-800 hover:border-gray-300"
                    } ${disabledReason ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    <input
                      id={id}
                      data-testid={`radio-channel-${opt}`}
                      type="radio"
                      name="otp-channel-preference"
                      checked={channelPreference === opt}
                      disabled={!!disabledReason}
                      onChange={() => !disabledReason && setChannelPreference(opt)}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{helper}</div>
                      {disabledReason && (
                        <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">{disabledReason}</div>
                      )}
                    </div>
                  </label>
                );
              })}
            </CardContent>
          </Card>

          {/* MSG91 credentials card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <KeyRound className="w-5 h-5 text-purple-600" />
                MSG91 credentials
              </CardTitle>
              <CardDescription>
                Get these from your MSG91 dashboard. The auth key is encrypted at rest and
                never shown back in full.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="auth-key">Auth key</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="auth-key"
                      data-testid="input-auth-key"
                      type={showAuthKey ? "text" : "password"}
                      value={authKeyChanged ? authKey : settings?.authKeyMasked || ""}
                      onChange={(e) => {
                        setAuthKeyChanged(true);
                        setAuthKey(e.target.value);
                      }}
                      onFocus={() => {
                        if (!authKeyChanged) {
                          setAuthKeyChanged(true);
                          setAuthKey("");
                        }
                      }}
                      placeholder={settings?.hasAuthKey ? "Enter new key to replace" : "Paste your MSG91 auth key"}
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAuthKey((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showAuthKey ? "Hide auth key" : "Show auth key"}
                    >
                      {showAuthKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {settings?.hasAuthKey && !authKeyChanged && (
                  <p className="text-xs text-muted-foreground">
                    A key is saved. Type a new value to replace it, or leave as-is to keep the current key.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sender-id">Sender ID</Label>
                  <Input
                    id="sender-id"
                    data-testid="input-sender-id"
                    value={senderId}
                    onChange={(e) => setSenderId(e.target.value)}
                    placeholder="e.g. CHRNEY"
                    maxLength={6}
                  />
                  <p className="text-xs text-muted-foreground">6-character DLT sender ID.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="template-id">Template ID</Label>
                  <Input
                    id="template-id"
                    data-testid="input-template-id"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    placeholder="DLT-approved template ID"
                  />
                  <p className="text-xs text-muted-foreground">
                    Created and approved in your MSG91 dashboard.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Template body card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="w-5 h-5 text-emerald-600" />
                OTP message template
              </CardTitle>
              <CardDescription>
                The body of the SMS your visitors receive. Use{" "}
                <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs">{"{{otp}}"}</code>{" "}
                where the 6-digit code should appear. This must match the body you registered
                in your MSG91 DLT template.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp-template-body">Template body</Label>
                <Textarea
                  id="otp-template-body"
                  data-testid="input-template-body"
                  value={otpTemplateBody}
                  onChange={(e) => setOtpTemplateBody(e.target.value)}
                  placeholder={DEFAULT_TEMPLATE_BODY}
                  rows={4}
                  maxLength={1000}
                />
                <p className="text-xs text-muted-foreground">
                  {otpTemplateBody.length}/1000 characters
                </p>
              </div>
              <div className="rounded-lg border border-dashed bg-gray-50 dark:bg-gray-900/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary">Preview</Badge>
                  <span className="text-xs text-muted-foreground">with sample code 123456</span>
                </div>
                <p
                  data-testid="text-template-preview"
                  className="text-sm whitespace-pre-wrap break-words"
                >
                  {previewBody || "(empty)"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Task #3: WhatsApp OTP template card. The auth-category template
              name must be approved in Meta Business Manager and live on the
              WhatsApp Cloud API number configured in WhatsApp settings. */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MessageSquare className="w-5 h-5 text-emerald-600" />
                WhatsApp OTP template
                {settings?.whatsappEffectivelyConfigured ? (
                  <Badge
                    data-testid="badge-whatsapp-status"
                    variant="secondary"
                    className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  >
                    Sender ready
                  </Badge>
                ) : (
                  <Badge
                    data-testid="badge-whatsapp-status"
                    variant="secondary"
                    className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  >
                    Not configured
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Name of the approved authentication-category template in Meta Business
                Manager. The 6-digit OTP is sent as the first body variable (
                <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs">{"{{1}}"}</code>
                ). Requires a working WhatsApp Cloud API integration in your WhatsApp
                settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="whatsapp-template-name">Template name</Label>
                <Input
                  id="whatsapp-template-name"
                  data-testid="input-whatsapp-template-name"
                  value={whatsappTemplateName}
                  onChange={(e) => setWhatsappTemplateName(e.target.value)}
                  placeholder="e.g. chroney_otp_v1"
                  maxLength={200}
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase, underscores allowed — exactly as registered in Meta. Must be
                  approved as an authentication template with one body variable for the OTP
                  code.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Test send card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Send className="w-5 h-5 text-blue-600" />
                Send a test code
              </CardTitle>
              <CardDescription>
                Fires a real OTP using your saved credentials so you can confirm delivery
                before going live. Subject to your provider's per-number quotas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Task #3: channel toggle on test panel — disabled options reflect
                  current configuration so admins can't pick something that will
                  always fail. */}
              <div className="flex items-center gap-2" role="radiogroup" aria-label="Test channel">
                {(["sms", "whatsapp"] as const).map((ch) => {
                  const available = ch === "sms"
                    ? !!settings?.effectivelyConfigured
                    : !!settings?.whatsappEffectivelyConfigured;
                  const active = testChannel === ch;
                  return (
                    <button
                      key={ch}
                      type="button"
                      data-testid={`button-test-channel-${ch}`}
                      role="radio"
                      aria-checked={active}
                      disabled={!available}
                      onClick={() => available && setTestChannel(ch)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                        active
                          ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                          : "border-gray-200 dark:border-gray-800 text-muted-foreground hover:border-gray-300"
                      } ${available ? "" : "opacity-50 cursor-not-allowed"}`}
                    >
                      {ch === "sms" ? "SMS" : "WhatsApp"}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  data-testid="input-test-phone"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+919876543210 or 9876543210"
                  className="flex-1"
                />
                <Button
                  onClick={handleTestSend}
                  disabled={testing || !testPhone.trim()}
                  data-testid="button-test-send"
                >
                  {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                  Send test
                </Button>
              </div>
              {testResult && (
                <Alert
                  data-testid="alert-test-result"
                  className={
                    testResult.ok
                      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                      : "border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20"
                  }
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  <AlertDescription>
                    {testResult.ok ? (
                      <>
                        Sent successfully to <strong>{testResult.phoneMasked}</strong> via{" "}
                        <strong>
                          {testResult.deliveryChannel === "whatsapp" ? "WhatsApp" : "SMS"}
                        </strong>
                        {testResult.providerMessageId && (
                          <> (request id: <code className="text-xs">{testResult.providerMessageId}</code>)</>
                        )}.
                      </>
                    ) : (
                      <>
                        Send failed: <strong>{testResult.error || "unknown error"}</strong>.{" "}
                        {testResult.deliveryChannel === "whatsapp"
                          ? "Check your WhatsApp template name, approval status, and Cloud API number."
                          : "Check your auth key, sender ID, template ID, and DLT approval status in MSG91."}
                      </>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3">
            <Button
              variant="outline"
              onClick={fetchSettings}
              disabled={saving}
              data-testid="button-reset"
            >
              Reset
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              data-testid="button-save"
            >
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save settings
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
