import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { GraduationCap, Loader2, RefreshCw, Users, Database, CloudDownload, KeyRound, Power, Workflow, ArrowRight, MessageSquare, Sparkles, Copy } from "lucide-react";

interface TopScholarConfig {
  ragEnabled: boolean;
  uatPlainCpId: boolean;
  contentDbUrl: string;
  externalContentDbDisabled: boolean;
  contentDbName: string;
  contentDbIndex: string;
  contentDbCollection: string;
  storeType: "pgvector" | "mongodb";
  apiBaseUrl: string;
  hasApiToken: boolean;
  syncMode: "sample" | "full";
  hasTokenSecret: boolean;
  requireSignedToken: boolean;
  doubtSyncBaseUrl: string;
  doubtResolutionCooldownSeconds: number | null;
}

interface StudentRow {
  conversationId: string;
  studentName: string | null;
  studentId: string | null;
  cpId: string | null;
  curriculumLabel: string;
  updatedAt: string;
}

interface SubjectReconciliationResult {
  scannedRows: number;
  usableSubjects: number;
  updatedMappings: number;
  unchangedMappings: number;
  unmatchedCpIds: number;
  conflictingSubjects: number;
}

async function getJson(url: string) {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error("Request failed");
  return r.json();
}

async function sendJson(url: string, method: string, body: any) {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Request failed");
  return data;
}

export default function TopScholarAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: config, isLoading: configLoading, isError: configError, error: configErrorObj } = useQuery<TopScholarConfig>({
    queryKey: ["/api/topscholar/config"],
    queryFn: async () => {
      const r = await fetch("/api/topscholar/config", { credentials: "include" });
      if (r.status === 403) throw new Error("FORBIDDEN");
      if (!r.ok) throw new Error("Request failed");
      return r.json();
    },
    retry: false,
  });

  const [uatPlainCpId, setUatPlainCpId] = useState(false);
  const [requireSignedToken, setRequireSignedToken] = useState(false);
  const [contentDbUrl, setContentDbUrl] = useState("");
  const [externalContentDbDisabled, setExternalContentDbDisabled] = useState(false);
  const [contentDbName, setContentDbName] = useState("");
  const [contentDbIndex, setContentDbIndex] = useState("");
  const [contentDbCollection, setContentDbCollection] = useState("");
  const [tokenSecret, setTokenSecret] = useState("");
  const [revealTokenSecret, setRevealTokenSecret] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [doubtSyncBaseUrl, setDoubtSyncBaseUrl] = useState("");
  const [doubtResolutionCooldownSeconds, setDoubtResolutionCooldownSeconds] = useState("");

  // Generate a strong random shared secret in the browser (Web Crypto, 32 bytes
  // -> 64 hex chars). This is the per-account secret to hand to the client portal;
  // it is NOT a per-student launch token. Generation only fills the field — the
  // admin must still click "Save changes" to persist it.
  const generateTokenSecret = () => {
    try {
      if (!window.crypto?.getRandomValues) {
        throw new Error("Secure random generator unavailable.");
      }
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      setTokenSecret(secret);
      setRevealTokenSecret(true);
      toast({
        title: "Secret generated",
        description: "Copy it to share with the client, then click Save changes to apply.",
      });
    } catch {
      toast({
        title: "Could not generate a secret",
        description: "Your browser blocked secure random generation. Enter a long random value manually.",
        variant: "destructive",
      });
    }
  };

  const copyTokenSecret = async () => {
    if (!tokenSecret) return;
    try {
      await navigator.clipboard.writeText(tokenSecret);
      toast({ title: "Copied", description: "Shared secret copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Select the value and copy it manually.", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (config) {
      setUatPlainCpId(config.uatPlainCpId);
      setRequireSignedToken(config.requireSignedToken);
      setContentDbUrl(config.contentDbUrl || "");
      setExternalContentDbDisabled(!!config.externalContentDbDisabled);
      setContentDbName(config.contentDbName || "");
      setContentDbIndex(config.contentDbIndex || "");
      setContentDbCollection(config.contentDbCollection || "");
      setApiBaseUrl(config.apiBaseUrl || "");
      setDoubtSyncBaseUrl(config.doubtSyncBaseUrl || "");
      setDoubtResolutionCooldownSeconds(
        config.doubtResolutionCooldownSeconds != null ? String(config.doubtResolutionCooldownSeconds) : ""
      );
    }
  }, [config]);

  // Derived: is the entered content DB URL a MongoDB connection string?
  const isMongo = /^mongodb(\+srv)?:\/\//i.test(contentDbUrl.trim());

  const saveConfig = useMutation({
    mutationFn: () =>
      sendJson("/api/topscholar/config", "PUT", {
        uatPlainCpId,
        requireSignedToken,
        contentDbUrl,
        externalContentDbDisabled,
        contentDbName,
        contentDbIndex,
        contentDbCollection,
        tokenSecret: tokenSecret || undefined,
        apiBaseUrl,
        apiToken: apiToken || undefined,
        doubtSyncBaseUrl,
        doubtResolutionCooldownSeconds:
          doubtResolutionCooldownSeconds.trim() === "" ? null : Number(doubtResolutionCooldownSeconds),
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/config"] });
      setTokenSecret("");
      setRevealTokenSecret(false);
      setApiToken("");
      toast({
        title: "Configuration saved",
        description: data?.warning || undefined,
      });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [mongoTest, setMongoTest] = useState<{ success: boolean; message: string } | null>(null);
  const testMongo = useMutation({
    mutationFn: () => sendJson("/api/topscholar/test-mongo", "POST", { contentDbUrl, contentDbName, contentDbCollection, contentDbIndex }),
    onSuccess: (data) => {
      setMongoTest(data);
      toast({ title: data.success ? "Connection OK" : "Connection failed", description: data.warning || data.message, variant: data.success ? undefined : "destructive" });
    },
    onError: (e: any) => {
      setMongoTest({ success: false, message: e.message });
      toast({ title: "Connection failed", description: e.message, variant: "destructive" });
    },
  });

  const [subjectReconciliation, setSubjectReconciliation] = useState<SubjectReconciliationResult | null>(null);
  const reconcileSubjects = useMutation({
    mutationFn: () => sendJson("/api/topscholar/reconcile-subjects", "POST", {}),
    onSuccess: (data: SubjectReconciliationResult) => {
      setSubjectReconciliation(data);
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/scope-options"] });
      toast({
        title: data.updatedMappings > 0 ? "Subject names imported" : "Subject names already match",
        description: `${data.updatedMappings} mapping${data.updatedMappings === 1 ? "" : "s"} updated from the client content database.`,
      });
    },
    onError: (e: any) => toast({
      title: "Could not import subject names",
      description: e.message,
      variant: "destructive",
    }),
  });

  const [apiTest, setApiTest] = useState<{ success: boolean; message: string } | null>(null);
  const testApi = useMutation({
    mutationFn: () => sendJson("/api/topscholar/test-content-bundle", "POST", { apiBaseUrl, apiToken: apiToken || undefined }),
    onSuccess: (data) => {
      setApiTest(data);
      toast({ title: data.success ? "Connection OK" : "Connection failed", description: data.message, variant: data.success ? undefined : "destructive" });
    },
    onError: (e: any) => {
      setApiTest({ success: false, message: e.message });
      toast({ title: "Connection failed", description: e.message, variant: "destructive" });
    },
  });

  const [portalTest, setPortalTest] = useState<{ ok: boolean; message: string } | null>(null);
  const testPortal = useMutation({
    mutationFn: () => getJson("/api/topscholar/portal/self-test"),
    onSuccess: (data: any) => {
      if (data?.ok) {
        const msg = `Portal API is live. It currently sees ${data.sample?.totalStudents ?? 0} students and ${data.sample?.totalConversations ?? 0} conversations.`;
        setPortalTest({ ok: true, message: msg });
        toast({ title: "Portal access OK", description: msg });
      } else {
        const msg = data?.message || "Portal access is not enabled yet.";
        setPortalTest({ ok: false, message: msg });
        toast({ title: "Not ready", description: msg, variant: "destructive" });
      }
    },
    onError: (e: any) => {
      setPortalTest({ ok: false, message: e.message });
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    },
  });

  // --- Students ---
  const { data: students } = useQuery<StudentRow[]>({
    queryKey: ["/api/topscholar/students"],
    queryFn: () => getJson("/api/topscholar/students"),
    enabled: !configError,
  });

  if (configLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (configError) {
    const forbidden = (configErrorObj as Error | null)?.message === "FORBIDDEN";
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-violet-600" /> Curriculum API
            </CardTitle>
            <CardDescription>
              {forbidden
                ? "Curriculum-mode content ingestion isn't available for this account."
                : "Couldn't load the curriculum configuration."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-500">
              {forbidden
                ? "This screen is reserved for the curriculum (TopScholar) workspace. If you believe you should have access, contact your administrator."
                : "There was a problem reaching the server. This is usually temporary — please try again."}
            </p>
            {!forbidden && (
              <Button
                variant="outline"
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/topscholar/config"] })}
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Retry
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">TopScholar Curriculum</h1>
          <p className="text-sm text-gray-500">Curriculum-scoped AI tutor — content packages, sync, and students</p>
        </div>
      </div>

      {/* How it works */}
      <Card className="border-violet-100 bg-gradient-to-br from-violet-50/70 to-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="w-5 h-5 text-violet-600" /> How it all fits together
          </CardTitle>
          <CardDescription>
            Curriculum flows from your source system into a database the chatbot can search, then students get grounded answers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
            {[
              { icon: CloudDownload, title: "Content Bundle API", body: "The source your curriculum is pulled from.", tone: "text-sky-700 bg-sky-50 border-sky-200" },
              { icon: RefreshCw, title: "Sync", body: "Fetches, chunks & embeds the content.", tone: "text-amber-700 bg-amber-50 border-amber-200" },
              { icon: Database, title: "Content Database", body: "Where embeddings live — what the chatbot reads from.", tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
              { icon: MessageSquare, title: "Student chat", body: "AI tutor quotes the matched curriculum.", tone: "text-violet-700 bg-violet-50 border-violet-200" },
            ].map((step, i, arr) => (
              <div key={step.title} className="flex items-center gap-2 lg:flex-1">
                <div className={`flex-1 rounded-lg border p-3 ${step.tone}`}>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <step.icon className="w-4 h-4" /> {step.title}
                  </div>
                  <p className="text-xs mt-1 opacity-80">{step.body}</p>
                </div>
                {i < arr.length - 1 && (
                  <ArrowRight className="w-4 h-4 shrink-0 text-gray-300 rotate-90 lg:rotate-0" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* AI Tutor status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className="w-5 h-5 text-violet-600" /> AI Tutor Status
          </CardTitle>
          <CardDescription>
            The curriculum tutor is always on for this account — the chatbot answers students using your synced curriculum.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-800">
            <Power className="w-4 h-4 shrink-0" />
            <span>Curriculum tutor is <strong>always on</strong> for this account.</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3">
            <div>
              <Label className="text-sm font-medium flex items-center gap-2">
                Testing mode: accept plain cp_id <Badge variant="secondary" className="bg-amber-100 text-amber-700">Testing only</Badge>
              </Label>
              <p className="text-xs text-gray-400">Allows binding a curriculum via URL without a signed launch token. Leave off in production.</p>
            </div>
            <Switch checked={uatPlainCpId} onCheckedChange={setUatPlainCpId} />
          </div>
          <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending} className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600">
            {saveConfig.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save changes
          </Button>
        </CardContent>
      </Card>

      {/* Content Database — what the chatbot reads from */}
      <Card className="border-emerald-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-600" /> Content Database
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">What the chatbot reads</Badge>
          </CardTitle>
          <CardDescription>
            This is the database the chatbot <strong>reads from</strong> to find and quote curriculum content while it answers students. Synced curriculum is stored here as searchable embeddings. Leave the URL blank to use the built-in local store.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {contentDbUrl.trim() !== "" && (
            <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="pr-4">
                <Label className="text-sm font-medium flex items-center gap-2">
                  Use external content database
                  {externalContentDbDisabled && <Badge variant="secondary" className="bg-amber-100 text-amber-700">Off · using local store</Badge>}
                </Label>
                <p className="text-xs text-gray-500">
                  When off, the chatbot reads from the built-in local store instead of the external database below — useful if the external DB is unreachable. Your saved connection details are kept, just not used. Turn it back on to resume using the external database.
                </p>
              </div>
              <Switch checked={!externalContentDbDisabled} onCheckedChange={(v) => setExternalContentDbDisabled(!v)} />
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Content DB URL</Label>
            <Input value={contentDbUrl} onChange={(e) => setContentDbUrl(e.target.value)} placeholder="(blank = built-in local store) · postgres://… · mongodb+srv://…" />
            <p className="text-xs text-gray-400">
              {contentDbUrl.trim() === ""
                ? "Blank uses the built-in local pgvector store — fine for testing. Content and embeddings stay in our database."
                : externalContentDbDisabled
                  ? "Switched off — the chatbot is currently reading from the built-in local store. These details are saved but not used until you turn the switch back on."
                  : isMongo
                    ? "Detected MongoDB Atlas — content and embeddings are stored ONLY in your DB (never in ours) and searched via $vectorSearch."
                    : "Detected PostgreSQL/pgvector store."}
            </p>
          </div>
          {isMongo && (
            <div className={`rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-4 ${externalContentDbDisabled ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                <span>MongoDB Atlas settings</span>
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">Vector Search</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Database name</Label>
                  <Input value={contentDbName} onChange={(e) => setContentDbName(e.target.value)} placeholder="e.g. teacher-connect-bot-user (or leave blank to use the DB in the URL)" />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Collection name</Label>
                  <Input value={contentDbCollection} onChange={(e) => setContentDbCollection(e.target.value)} placeholder="e.g. chatbot-teacher-connect (blank = topscholar_embeddings)" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="text-sm font-medium">Vector Search index name</Label>
                  <Input value={contentDbIndex} onChange={(e) => setContentDbIndex(e.target.value)} placeholder="e.g. topscholar_vector_index" />
                </div>
              </div>
              <p className="text-xs text-emerald-700/80">
                Create an Atlas Vector Search index on the <code>embedding</code> field (1536 dims, cosine) in your collection, with filters on{" "}
                <code>business_account_id</code>, <code>cp_id</code>, and <code>content_type</code>. Leave the collection blank to use the
                default <code>topscholar_embeddings</code>.
              </p>
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" size="sm" onClick={() => testMongo.mutate()} disabled={!contentDbUrl.trim() || externalContentDbDisabled || testMongo.isPending} className="gap-2">
                  {testMongo.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Test Connection
                </Button>
                {mongoTest && (
                  <span className={`text-xs ${mongoTest.success ? "text-emerald-700" : "text-red-600"}`}>
                    {mongoTest.success ? "✓ " : "✗ "}{(mongoTest as any).warning || mongoTest.message}
                  </span>
                )}
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                <div>
                  <Label className="text-sm font-medium text-amber-950">Fix Tester subject labels</Label>
                  <p className="mt-1 text-xs text-amber-900/80">
                    Reads each stored CP&apos;s subject name from this client database once and updates only the app&apos;s CP mapping metadata. It never changes client content and does not run while opening the Widget Tester.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 border-amber-300 bg-white hover:bg-amber-100"
                  disabled={!contentDbUrl.trim() || externalContentDbDisabled || reconcileSubjects.isPending}
                  onClick={() => {
                    if (window.confirm("Import the current subject names from the client content database into the app's Tester mappings? This does not modify client content.")) {
                      reconcileSubjects.mutate();
                    }
                  }}
                >
                  {reconcileSubjects.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Import subject names once
                </Button>
                {subjectReconciliation && (
                  <p className="text-xs text-amber-900/80">
                    Read {subjectReconciliation.usableSubjects} CP subject{subjectReconciliation.usableSubjects === 1 ? "" : "s"}; updated {subjectReconciliation.updatedMappings}, unchanged {subjectReconciliation.unchangedMappings}.
                    {subjectReconciliation.unmatchedCpIds > 0 && ` ${subjectReconciliation.unmatchedCpIds} CP ID${subjectReconciliation.unmatchedCpIds === 1 ? "" : "s"} had no app mapping.`}
                    {subjectReconciliation.conflictingSubjects > 0 && ` ${subjectReconciliation.conflictingSubjects} CP ID${subjectReconciliation.conflictingSubjects === 1 ? "" : "s"} had conflicting client subjects and was skipped.`}
                  </p>
                )}
              </div>
            </div>
          )}
          <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending} className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600">
            {saveConfig.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save changes
          </Button>
        </CardContent>
      </Card>

      {/* Content Bundle API — the ingestion source */}
      <Card className="border-sky-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CloudDownload className="w-5 h-5 text-sky-600" /> Content Bundle API
            <Badge variant="secondary" className="bg-sky-100 text-sky-700">Source</Badge>
          </CardTitle>
          <CardDescription>
            The external service your curriculum is <strong>pulled from</strong> during a sync. Content fetched here is chunked, embedded, and saved into the Content Database above — the chatbot never reads this API directly. Leave the URL blank to use built-in sample fixtures.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-sm font-medium">API Endpoint URL</Label>
            <Input value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="https://preprod.toppscholars.com/plan-and-promo/api/Plan/content-bundle (blank = sample fixtures)" />
            <p className="text-xs text-gray-400">Full endpoint URL — used exactly as entered, with no path appended.</p>
            {apiBaseUrl.trim() === "" && (
              <p className="text-xs text-amber-600">No URL set — syncs will use built-in sample fixtures instead of live curriculum.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">API Token (optional) {config?.hasApiToken && <Badge variant="secondary">set</Badge>}</Label>
            <Input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder={config?.hasApiToken ? "•••••• (leave blank to keep)" : "Bearer token — UAT has no auth"} />
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => testApi.mutate()} disabled={!apiBaseUrl.trim() || testApi.isPending} className="gap-2">
              {testApi.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Test Connection
            </Button>
            {apiTest && (
              <span className={`text-xs ${apiTest.success ? "text-emerald-700" : "text-red-600"}`}>
                {apiTest.success ? "✓ " : "✗ "}{apiTest.message}
              </span>
            )}
          </div>
          <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending} className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600">
            {saveConfig.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save changes
          </Button>
        </CardContent>
      </Card>

      {/* Launch security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-violet-600" /> Launch Security
          </CardTitle>
          <CardDescription>
            The shared secret used to verify signed launch tokens from TopScholar, so only authorised student sessions can bind to a curriculum.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Launch Token Secret {config?.hasTokenSecret && <Badge variant="secondary">set</Badge>}</Label>
            <div className="flex items-center gap-2">
              <Input
                type={revealTokenSecret ? "text" : "password"}
                value={tokenSecret}
                onChange={(e) => setTokenSecret(e.target.value)}
                placeholder={config?.hasTokenSecret ? "•••••• (leave blank to keep)" : "Enter or generate a secret"}
                className="font-mono"
              />
              <Button type="button" variant="outline" size="sm" onClick={generateTokenSecret} className="gap-1.5 shrink-0">
                <Sparkles className="w-4 h-4" /> Generate
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={copyTokenSecret} disabled={!tokenSecret} className="gap-1.5 shrink-0">
                <Copy className="w-4 h-4" /> Copy
              </Button>
            </div>
            <p className="text-xs text-gray-400">
              This is the <strong>shared secret</strong> — one value for this account that you also give the client's portal
              team to store as a server-side env var. It must match exactly on both sides. It is <strong>not</strong> a
              per-student token (those are signed by the portal at runtime). Generate fills the field; click Save changes to
              apply. Leave blank to keep the existing secret. Keep it server-side only — never expose it in client code.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50/60 p-3">
            <div className="pr-4">
              <Label className="text-sm font-medium flex items-center gap-2">
                Require signed token <Badge variant="secondary" className="bg-violet-100 text-violet-700">Secure mode</Badge>
              </Label>
              <p className="text-xs text-gray-500">
                When on, the tutor trusts <strong>only</strong> a signed launch token. Plain board/medium/grade/subject
                attributes are ignored and an unsigned launch is refused. Turn this on for production once your portal
                signs tokens. Requires a Launch Token Secret to be set.
              </p>
            </div>
            <Switch checked={requireSignedToken} onCheckedChange={setRequireSignedToken} disabled={!config?.hasTokenSecret && !tokenSecret} />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              Doubt Sync API base URL
              <Badge variant="secondary" className="bg-violet-100 text-violet-700">Doubt sync</Badge>
            </Label>
            <Input
              type="text"
              value={doubtSyncBaseUrl}
              onChange={(e) => setDoubtSyncBaseUrl(e.target.value)}
              placeholder="https://dev5.toppscholars.com"
              className="font-mono"
            />
            <p className="text-xs text-gray-400">
              Base URL of the client portal's conversation-sync / doubt-close API. When set — and a launch token carries a{" "}
              <code className="px-1 py-0.5 bg-gray-100 rounded">doubtId</code> — the tutor mirrors each message back to the
              portal, closes the doubt on session end, and routes student image uploads through the portal's storage. Leave
              blank to disable doubt sync. HTTPS only.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              Doubt-resolution prompt delay
              <Badge variant="secondary" className="bg-violet-100 text-violet-700">Doubt sync</Badge>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={10}
                max={3600}
                value={doubtResolutionCooldownSeconds}
                onChange={(e) => setDoubtResolutionCooldownSeconds(e.target.value)}
                placeholder="120"
                className="w-40"
              />
              <span className="text-sm text-gray-500">seconds</span>
            </div>
            <p className="text-xs text-gray-400">
              After the tutor answers a doubt-scoped session, if the student stays idle for this many seconds the widget
              asks <em>"Did this resolve your doubt?"</em>. <strong>Yes</strong> marks the doubt resolved on your portal;{" "}
              <strong>No</strong> escalates it to a support ticket. Leave blank to use the default (120 seconds). Range 10–3600.
            </p>
          </div>

          <Button onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending} className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600">
            {saveConfig.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save changes
          </Button>

          <details className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 text-sm">
            <summary className="cursor-pointer font-medium text-gray-700">Integration guide — how your portal signs a launch token</summary>
            <div className="mt-3 space-y-3 text-xs text-gray-600">
              <p>
                On your server, build a token that seals the logged-in student's details, then drop it into the widget
                embed as <code className="px-1 py-0.5 bg-gray-100 rounded">data-token</code>. The secret never leaves your
                server, so the values can't be tampered with in the browser.
              </p>
              <p><strong>Required fields:</strong> <code>board</code>, <code>medium</code>, <code>grade</code>, <code>subject</code>, <code>studentId</code>, <code>name</code>. <strong>Optional:</strong> <code>chapter</code> — narrows answers to a single chapter; omit for whole-subject scope. We recommend a short <code>exp</code> (e.g. 15 minutes).</p>
              <p><strong>Doubt sync (optional):</strong> to bind this session to a doubt on your portal, also seal <code>doubtId</code> in the token — when present (and a Doubt Sync API base URL is configured above) the tutor keys the session to that doubt, mirrors messages back to your portal, routes the student's image uploads through your storage, and closes the doubt on session end. You may also include <code>studentPlanMappingId</code> and <code>planId</code>, which are stored for reference.</p>
              <p><strong>Token format:</strong> <code>base64url(JSON payload)</code> + <code>"."</code> + <code>base64url(HMAC-SHA256(payload, secret))</code>.</p>
              <pre className="overflow-x-auto rounded bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">{`// Node.js — sign a launch token (no extra dependencies)
const crypto = require('crypto');

function signLaunchToken(secret, fields) {
  const payload = {
    board: fields.board,
    medium: fields.medium,
    grade: fields.grade,
    subject: fields.subject,
    chapter: fields.chapter, // optional — omit for whole-subject scope
    studentId: fields.studentId,
    name: fields.name,
    doubtId: fields.doubtId, // optional — enables doubt sync (mirror + close + image routing)
    studentPlanMappingId: fields.studentPlanMappingId, // optional — stored for reference
    planId: fields.planId, // optional — stored for reference
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 min
  };
  const b64 = (b) => Buffer.from(b).toString('base64')
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  const encoded = b64(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest();
  return encoded + '.' + b64(sig);
}

// Then render the embed with the token:
// <script src="https://YOUR_DOMAIN/widget-loader.js"
//   data-business-id="YOUR_BUSINESS_ID"
//   data-token="\${signLaunchToken(SECRET, student)}"></script>`}</pre>
              <p className="text-amber-600">Keep the secret server-side only. Never expose it in client-side code.</p>
            </div>
          </details>

          <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-sm font-medium">Portal data API (pull)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => testPortal.mutate()}
                disabled={testPortal.isPending}
                className="gap-1.5 shrink-0"
              >
                {testPortal.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Test access
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Your client portal's <strong>backend</strong> can pull a student's past conversations and insights on demand.
              It authenticates with this same shared secret as a Bearer credential — call from the server only, never the
              browser. Every response is scoped to this account.
            </p>
            <pre className="overflow-x-auto rounded bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">{`# Authenticate every call with the shared secret:
#   Authorization: Bearer <shared secret>

GET /api/topscholar/portal/students                 # roster + summary
GET /api/topscholar/portal/students/:studentId      # one student's insights
GET /api/topscholar/portal/students/:studentId/conversations          # past conversations
GET /api/topscholar/portal/students/:studentId/conversations/:id      # full transcript

# The two list endpoints (students, conversations) are cursor-paginated.
# They return { "items": [...], "nextCursor": "<token>" | null }.
# Follow nextCursor until it is null to pull EVERYTHING — no page numbers,
# no page size, nothing dropped:
#   GET .../students                  -> { items, nextCursor }
#   GET .../students?cursor=<token>   -> next batch ... repeat until nextCursor is null

# Incremental cron sync: pass updatedAfter (ISO-8601) to fetch only what
# changed since the last run. Results lag ~60s so an in-flight chat is never
# half-captured. Combine with cursor exactly the same way:
#   GET .../students?updatedAfter=2026-06-21T00:00:00Z
#   GET .../students/:id/conversations?updatedAfter=2026-06-21T00:00:00Z

# Roster search still works and composes with cursor + updatedAfter:
#   GET .../students?q=anjali`}</pre>
            {portalTest && (
              <p className={`text-xs ${portalTest.ok ? "text-green-600" : "text-red-600"}`}>{portalTest.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Students */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-600" /> Students
          </CardTitle>
          <CardDescription>Conversations bound to a curriculum, with the resolved board / medium / grade.</CardDescription>
        </CardHeader>
        <CardContent>
          {students && students.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr><th className="text-left p-2">Student</th><th className="text-left p-2">Curriculum</th><th className="text-left p-2">cp_id</th><th className="text-left p-2">Last active</th></tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.conversationId} className="border-t">
                      <td className="p-2">{s.studentName || <span className="text-gray-400">Anonymous</span>}</td>
                      <td className="p-2">{s.curriculumLabel || <span className="text-gray-400">—</span>}</td>
                      <td className="p-2 font-mono">{s.cpId}</td>
                      <td className="p-2">{new Date(s.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No curriculum-bound conversations yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
