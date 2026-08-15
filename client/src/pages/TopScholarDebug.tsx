import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Redirect } from "wouter";
import type { MeResponseDto } from "@shared/dto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bug,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  KeyRound,
  Layers,
  Send,
  Activity,
  RefreshCw,
} from "lucide-react";

// ---------- shared bits ----------

function PassFail({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
  ) : (
    <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
  );
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

// ---------- Tab 1: Token Inspector ----------

interface TokenCheck {
  ok: boolean;
  label: string;
  detail: string;
}
interface TokenResult {
  valid: boolean;
  reason: string | null;
  payload: Record<string, unknown> | null;
  checks: TokenCheck[];
  secretConfigured: boolean;
  requireSignedToken: boolean;
}

function TokenInspector() {
  const [token, setToken] = useState("");
  const verify = useMutation<TokenResult, Error, string>({
    mutationFn: (t) => postJson("/api/topscholar/debug/verify-token", { token: t }),
  });
  const r = verify.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> Token Inspector
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Paste any launch token to see exactly why it passes or fails — signature, expiry, scope fields, and doubt-sync readiness.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="eyJib2FyZCI6Ik1haGFyYXNodHJhIEJvYXJkIiwi….signature"
          rows={4}
          className="font-mono text-xs"
          data-testid="input-debug-token"
        />
        <Button
          onClick={() => verify.mutate(token.trim())}
          disabled={!token.trim() || verify.isPending}
          data-testid="button-verify-token"
        >
          {verify.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Verify Token
        </Button>
        {verify.error && (
          <p className="text-sm text-red-600">{verify.error.message}</p>
        )}
        {r && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {r.valid ? (
                <Badge className="bg-green-600">VALID</Badge>
              ) : (
                <Badge variant="destructive">INVALID</Badge>
              )}
              {r.reason && <span className="text-sm text-red-600">{r.reason}</span>}
              {!r.secretConfigured && (
                <span className="text-sm text-amber-600">No launch secret configured on this account.</span>
              )}
            </div>
            <div className="space-y-2">
              {r.checks.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-sm" data-testid={`check-${c.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  <PassFail ok={c.ok} />
                  <div>
                    <span className="font-medium">{c.label}:</span>{" "}
                    <span className={c.ok ? "text-muted-foreground" : "text-red-700"}>{c.detail}</span>
                  </div>
                </div>
              ))}
            </div>
            {r.payload && (
              <div>
                <Label className="text-xs text-muted-foreground">Decoded payload</Label>
                <pre className="mt-1 rounded-md bg-muted p-3 text-xs overflow-x-auto" data-testid="text-token-payload">
                  {JSON.stringify(r.payload, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Tab 2: Scope Resolver ----------

interface MappingRow {
  cpId: string;
  board: string | null;
  medium: string | null;
  grade: string | null;
  subject: string | null;
  cpName: string | null;
}
interface ScopeResult {
  cpIds: string[];
  matchedRows: MappingRow[];
  explanation: string;
  availableForBroaderScope: MappingRow[];
}

function RowsTable({ rows }: { rows: MappingRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Board</th>
            <th className="px-2 py-1.5 text-left font-medium">Medium</th>
            <th className="px-2 py-1.5 text-left font-medium">Grade</th>
            <th className="px-2 py-1.5 text-left font-medium">Subject</th>
            <th className="px-2 py-1.5 text-left font-medium">Pack name</th>
            <th className="px-2 py-1.5 text-left font-medium">cp_id</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              <td className="px-2 py-1.5">{row.board || "—"}</td>
              <td className="px-2 py-1.5">{row.medium || "—"}</td>
              <td className="px-2 py-1.5">{row.grade || "—"}</td>
              <td className="px-2 py-1.5">{row.subject || <span className="text-amber-600">blank</span>}</td>
              <td className="px-2 py-1.5">{row.cpName || "—"}</td>
              <td className="px-2 py-1.5 font-mono">{row.cpId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScopeResolver() {
  const [board, setBoard] = useState("");
  const [medium, setMedium] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [showAll, setShowAll] = useState(false);

  const resolve = useMutation<ScopeResult, Error, void>({
    mutationFn: () => postJson("/api/topscholar/debug/resolve-scope", { board, medium, grade, subject }),
  });
  const allScopes = useQuery<{ scopes: MappingRow[] }>({
    queryKey: ["/api/topscholar/debug/available-scopes"],
    enabled: showAll,
  });
  const r = resolve.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" /> Scope Resolver
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Enter a student's scope to see which content packs the AI would use — and why a subject may resolve to nothing.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["Board", board, setBoard, "e.g. ICSE"],
            ["Medium", medium, setMedium, "e.g. English"],
            ["Grade", grade, setGrade, "e.g. 6"],
            ["Subject", subject, setSubject, "e.g. History"],
          ].map(([label, val, set, ph]: any) => (
            <div key={label}>
              <Label className="text-xs">{label}</Label>
              <Input value={val} onChange={(e) => set(e.target.value)} placeholder={ph} data-testid={`input-scope-${String(label).toLowerCase()}`} />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => resolve.mutate()} disabled={resolve.isPending} data-testid="button-resolve-scope">
            {resolve.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Resolve
          </Button>
          <Button variant="outline" onClick={() => setShowAll((v) => !v)} data-testid="button-show-all-scopes">
            {showAll ? "Hide" : "Show"} all available content
          </Button>
        </div>
        {resolve.error && <p className="text-sm text-red-600">{resolve.error.message}</p>}
        {r && (
          <div className="space-y-3">
            <div
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                r.cpIds.length > 0 ? "border-green-200 bg-green-50 dark:bg-green-950/20" : "border-red-200 bg-red-50 dark:bg-red-950/20"
              }`}
              data-testid="text-scope-explanation"
            >
              {r.cpIds.length > 0 ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              )}
              <span>{r.explanation}</span>
            </div>
            {r.matchedRows.length > 0 && <RowsTable rows={r.matchedRows} />}
            {r.cpIds.length === 0 && r.availableForBroaderScope.length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">What IS available for this board/medium/grade:</Label>
                <div className="mt-1">
                  <RowsTable rows={r.availableForBroaderScope} />
                </div>
              </div>
            )}
          </div>
        )}
        {showAll && (
          <div>
            <Label className="text-xs text-muted-foreground">All content packs on this account</Label>
            <div className="mt-1">
              {allScopes.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RowsTable rows={allScopes.data?.scopes || []} />
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Tab 3: Sync Tester ----------

interface SyncResult {
  ok: boolean;
  request: { url: string; method: string; fields: Record<string, string> };
  response: { status: number; statusText: string; bodySnippet: string } | null;
  latencyMs: number;
  error: string | null;
  doubtSyncConfigured: boolean;
}

function SyncTester() {
  const [doubtId, setDoubtId] = useState("");
  const [message, setMessage] = useState("Debug test message from AI Chroney admin panel.");
  const test = useMutation<SyncResult, Error, void>({
    mutationFn: () => postJson("/api/topscholar/debug/test-sync", { doubtId, message, from: "sme" }),
  });
  const r = test.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="h-4 w-4" /> Sync Tester
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Fires a REAL message-save POST to the TopScholar platform and shows the raw HTTP response. Use a test doubt ID — the message will appear in that doubt's conversation.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs">Doubt ID</Label>
          <Input value={doubtId} onChange={(e) => setDoubtId(e.target.value)} placeholder="e.g. 66c1f2…" data-testid="input-sync-doubt-id" />
        </div>
        <div>
          <Label className="text-xs">Test message</Label>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} data-testid="input-sync-message" />
        </div>
        <Button onClick={() => test.mutate()} disabled={!doubtId.trim() || !message.trim() || test.isPending} data-testid="button-test-sync">
          {test.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Send Test Sync
        </Button>
        {test.error && <p className="text-sm text-red-600">{test.error.message}</p>}
        {r && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              {r.ok ? <Badge className="bg-green-600">SUCCESS</Badge> : <Badge variant="destructive">FAILED</Badge>}
              <span className="text-muted-foreground">{r.latencyMs} ms</span>
              {r.error && <span className="text-red-600">{r.error}</span>}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Request sent</Label>
              <pre className="mt-1 rounded-md bg-muted p-3 text-xs overflow-x-auto" data-testid="text-sync-request">
                {`${r.request.method} ${r.request.url}\n${JSON.stringify(r.request.fields, null, 2)}`}
              </pre>
            </div>
            {r.response && (
              <div>
                <Label className="text-xs text-muted-foreground">Response from TopScholar's server</Label>
                <pre className="mt-1 rounded-md bg-muted p-3 text-xs overflow-x-auto" data-testid="text-sync-response">
                  {`HTTP ${r.response.status} ${r.response.statusText}\n${r.response.bodySnippet || "(empty body)"}`}
                </pre>
              </div>
            )}
            {!r.doubtSyncConfigured && (
              <p className="text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" /> Doubt-sync base URL is not configured on this account.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Tab 4: Live Request Log ----------

interface DebugEvent {
  id: string;
  ts: string;
  kind: string;
  studentId?: string;
  studentName?: string;
  doubtId?: string;
  data: Record<string, unknown>;
}

const KIND_STYLES: Record<string, { label: string; cls: string }> = {
  token_check: { label: "Token", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
  scope_resolution: { label: "Scope", cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
  sync_result: { label: "Sync", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  refusal: { label: "Refusal", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  chat_request: { label: "Chat", cls: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" },
  sync_attempt: { label: "Sync try", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
};

// An event is "bad" when it represents a failure the admin should look at.
function eventIsBad(e: DebugEvent): boolean {
  if (e.kind === "refusal") return true;
  if (e.kind === "token_check" && e.data.status === "invalid") return true;
  if (e.kind === "scope_resolution" && e.data.cpIdsResolved === 0) return true;
  if (e.kind === "sync_result" && e.data.ok === false) return true;
  return false;
}

function eventSummary(e: DebugEvent): string {
  switch (e.kind) {
    case "token_check":
      return e.data.status === "absent"
        ? "No token supplied"
        : e.data.status === "valid"
          ? `Valid token${e.data.scope ? ` · ${e.data.scope}` : ""}`
          : `Token REJECTED: ${e.data.reason || "unknown"}`;
    case "scope_resolution":
      return `${e.data.scope} → ${e.data.cpIdsResolved} pack(s)${e.data.warning ? ` — ${e.data.warning}` : ""}`;
    case "sync_result":
      return `${e.data.syncKind}: ${e.data.ok ? "OK" : "FAILED"} (${e.data.detail})`;
    case "refusal":
      return `Refused: ${e.data.reason}`;
    default:
      return JSON.stringify(e.data).slice(0, 140);
  }
}

function LiveLog() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = useQuery<{ events: DebugEvent[] }>({
    queryKey: ["/api/topscholar/debug/events"],
    refetchInterval: 5000,
  });
  const events = q.data?.events || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Live Request Log
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => q.refetch()} data-testid="button-refresh-log">
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Every TopScholar chat decision, live (auto-refreshes every 5 s; last 200 events; clears on server restart). Red rows need attention.
        </p>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No events yet. Open the widget (or run a tester session) and events will appear here.
          </p>
        ) : (
          <div className="space-y-1">
            {events.map((e) => {
              const style = KIND_STYLES[e.kind] || KIND_STYLES.chat_request;
              const bad = eventIsBad(e);
              return (
                <div
                  key={e.id}
                  className={`rounded-md border px-3 py-2 text-sm cursor-pointer ${bad ? "border-red-200 bg-red-50 dark:bg-red-950/20" : ""}`}
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  data-testid={`log-event-${e.id}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground font-mono">
                      {new Date(e.ts).toLocaleTimeString()}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${style.cls}`}>{style.label}</span>
                    {e.studentName && <span className="text-xs font-medium">{e.studentName}</span>}
                    {e.doubtId && <span className="text-xs text-muted-foreground font-mono">doubt {e.doubtId.slice(0, 8)}…</span>}
                    <span className={`truncate ${bad ? "text-red-700 dark:text-red-300" : ""}`}>{eventSummary(e)}</span>
                  </div>
                  {expanded === e.id && (
                    <pre className="mt-2 rounded bg-muted p-2 text-xs overflow-x-auto">{JSON.stringify(e, null, 2)}</pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Page ----------

export default function TopScholarDebug() {
  const { data: me, isLoading: meLoading } = useQuery<MeResponseDto>({
    queryKey: ["/api/auth/me"],
  });

  if (meLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (me?.businessAccount?.isTopscholar !== true) {
    return <Redirect to="/" />;
  }

  return (
    <div className="container mx-auto max-w-5xl p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-gradient-to-br from-red-500 to-orange-600 p-2">
          <Bug className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">TopScholar Debug</h1>
          <p className="text-sm text-muted-foreground">
            Diagnose token, curriculum-scope, and conversation-sync issues end to end.
          </p>
        </div>
      </div>

      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="log" data-testid="tab-live-log">Live Log</TabsTrigger>
          <TabsTrigger value="token" data-testid="tab-token">Token Inspector</TabsTrigger>
          <TabsTrigger value="scope" data-testid="tab-scope">Scope Resolver</TabsTrigger>
          <TabsTrigger value="sync" data-testid="tab-sync">Sync Tester</TabsTrigger>
        </TabsList>
        <TabsContent value="log"><LiveLog /></TabsContent>
        <TabsContent value="token"><TokenInspector /></TabsContent>
        <TabsContent value="scope"><ScopeResolver /></TabsContent>
        <TabsContent value="sync"><SyncTester /></TabsContent>
      </Tabs>
    </div>
  );
}
