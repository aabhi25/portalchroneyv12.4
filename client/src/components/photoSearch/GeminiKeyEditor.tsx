import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ImageIcon, KeyRound, Loader2, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Gemini (Google AI Studio) keys for photo search.
 *  - scope "platform": Super admin › AI providers › Photo search; used by every account without its own key
 *  - scope "account": Super Admin › API Keys; the account's own key
 * Keys are write-only: the server returns ••••last4 and never the key.
 */

export interface PhotoSearchStatus {
  engine: "gemini" | "none";
  keySource: "account" | "platform" | null;
  accountKey: { configured: boolean; masked: string | null };
  platformKeyConfigured: boolean;
  usesPhotoSearch: boolean;
  products: { withPhoto: number; indexed: number; failed: number };
}

interface PlatformKeyView {
  configured: boolean;
  source: "settings" | "env" | null;
  masked: string | null;
}

const PLATFORM_KEY = ["/api/super-admin/photo-search/platform-key"];
export const photoSearchStatusKey = (businessAccountId: string) => ["/api/business-accounts", businessAccountId, "photo-search"];

export function usePhotoSearchStatus(businessAccountId: string, enabled = true) {
  return useQuery<PhotoSearchStatus>({
    queryKey: photoSearchStatusKey(businessAccountId),
    queryFn: () => apiRequest<PhotoSearchStatus>("GET", `/api/business-accounts/${businessAccountId}/photo-search`),
    enabled,
    staleTime: 0,
  });
}

/** One line describing where an account's photo search stands. */
export function photoSearchSummary(status: PhotoSearchStatus): { text: string; warn: boolean } {
  if (status.engine === "none") {
    return { text: "No Gemini key yet, so photo search finds nothing. Add one in Super Admin › API Keys.", warn: true };
  }
  const { withPhoto, indexed, failed } = status.products;
  const source = status.keySource === "account" ? "this account's own key" : "the platform key";
  const progress = withPhoto === 0
    ? "no product photos yet"
    : indexed >= withPhoto - failed
      ? `all ${indexed} product photos indexed`
      : `${indexed} of ${withPhoto} product photos indexed so far`;
  return { text: `Gemini, using ${source} · ${progress}${failed ? ` · ${failed} photos couldn't be read` : ""}`, warn: false };
}

function KeyEditor({
  label,
  configured,
  masked,
  sourceBadge,
  canRemove,
  onSave,
  onRemove,
  onTest,
  testId,
}: {
  label: string;
  configured: boolean;
  masked: string | null;
  sourceBadge?: string | null;
  canRemove: boolean;
  onSave: (key: string) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
  onTest: (typedKey: string | null) => Promise<{ success: boolean; message: string }>;
  testId: string;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const save = useMutation({
    mutationFn: () => onSave(value.trim()),
    onSuccess: () => { setValue(""); setEditing(false); setResult(null); toast({ title: `${label} saved` }); },
    onError: (e: Error) => toast({ title: "Could not save key", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: onRemove,
    onSuccess: () => { setResult(null); toast({ title: `${label} removed` }); },
    onError: (e: Error) => toast({ title: "Could not remove key", description: e.message, variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: () => onTest(editing || !configured ? value.trim() : null),
    onSuccess: (r) => setResult({ ok: r.success, text: r.message }),
    onError: (e: Error) => setResult({ ok: false, text: e.message }),
  });

  const typing = editing || !configured;
  return (
    <div className="rounded-lg border p-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4 text-gray-500" />{label}</span>
        {configured ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="font-mono">{masked}</span>
            {sourceBadge && <Badge variant="secondary">{sourceBadge}</Badge>}
          </span>
        ) : <span className="text-xs text-gray-500">Not set</span>}
      </div>
      {typing ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Google AI Studio API key" data-testid={`${testId}-input`} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={value.trim().length < 8 || save.isPending} data-testid={`${testId}-save`}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={value.trim().length < 8 || test.isPending}>
              {test.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Test key
            </Button>
            {configured && <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setValue(""); }}>Cancel</Button>}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Replace</Button>
          <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
            {test.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Test key
          </Button>
          {canRemove && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove</Button>}
        </div>
      )}
      {result && (
        <p className={`mt-2 flex items-center gap-1 text-xs ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
          {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{result.text}
        </p>
      )}
    </div>
  );
}

const testKey = (body: Record<string, unknown>) =>
  apiRequest<{ success: boolean; message: string }>("POST", "/api/super-admin/photo-search/test-key", body);

/** Super admin › AI providers › Photo search: the platform's Gemini key, used by every account without its own. */
export function GeminiPlatformKeyCard() {
  const { data, isLoading } = useQuery<PlatformKeyView>({
    queryKey: PLATFORM_KEY,
    queryFn: () => apiRequest<PlatformKeyView>("GET", "/api/super-admin/photo-search/platform-key"),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: PLATFORM_KEY });
  return (
    <Card data-testid="card-gemini-platform-key">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ImageIcon className="h-5 w-5 text-purple-600" />Photo search — platform Gemini key</CardTitle>
        <CardDescription>
          Our Google AI Studio key for photo search (Vista and Visual product search). Every account without its own key (on the
          account's AI &amp; keys tab) uses it, billed to us. Use a Google project with billing on, so customers' photos aren't used by Google.
          Keys are encrypted and only the last 4 characters are shown.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading…</div>
        ) : (
          <KeyEditor
            label="Platform Gemini key"
            configured={data.configured}
            masked={data.masked}
            sourceBadge={data.source === "env" ? "from server setting" : null}
            canRemove={data.source === "settings"}
            onSave={async (key) => { await apiRequest("PUT", "/api/super-admin/photo-search/platform-key", { apiKey: key }); await refresh(); }}
            onRemove={async () => { await apiRequest("DELETE", "/api/super-admin/photo-search/platform-key"); await refresh(); }}
            onTest={(typed) => testKey(typed ? { apiKey: typed } : {})}
            testId="gemini-platform-key"
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Super Admin › API Keys: an account's own Gemini key, with where its photo search stands. */
export function GeminiAccountKeyEditor({ businessAccountId }: { businessAccountId: string }) {
  const { data, isLoading } = usePhotoSearchStatus(businessAccountId);
  const refresh = () => queryClient.invalidateQueries({ queryKey: photoSearchStatusKey(businessAccountId) });
  if (isLoading || !data) {
    return <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading…</div>;
  }
  const summary = photoSearchSummary(data);
  return (
    <div className="space-y-2">
      <KeyEditor
        label="This account's Gemini key"
        configured={data.accountKey.configured}
        masked={data.accountKey.masked}
        canRemove={data.accountKey.configured}
        onSave={async (key) => { await apiRequest("PUT", `/api/business-accounts/${businessAccountId}/photo-search-key`, { apiKey: key }); await refresh(); }}
        onRemove={async () => { await apiRequest("PUT", `/api/business-accounts/${businessAccountId}/photo-search-key`, { apiKey: null }); await refresh(); }}
        onTest={(typed) => testKey(typed ? { apiKey: typed } : { businessAccountId })}
        testId="gemini-account-key"
      />
      <p className="text-xs text-muted-foreground">
        {data.accountKey.configured
          ? "Google bills this account's photo searches to this key."
          : data.platformKeyConfigured
            ? "Empty: this account uses the platform key from AI providers › Photo search."
            : "Empty, and there's no platform key in AI providers › Photo search either."}
      </p>
      <p className={`text-xs ${summary.warn ? "text-amber-700" : "text-muted-foreground"}`} data-testid="text-photo-search-status">{summary.text}</p>
    </div>
  );
}
