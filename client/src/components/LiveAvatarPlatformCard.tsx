import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2, Video, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PlatformView {
  providers: Array<{ id: string; label: string; configured: boolean; source: "settings" | "env" | null; masked: string | null }>;
  rates: Record<string, number>;
  fakeAvailable: boolean;
}

const KEY = ["/api/super-admin/avatar/platform"];

function PlatformKeyRow({ provider }: { provider: PlatformView["providers"][number] }) {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const save = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/super-admin/avatar/platform/keys/${provider.id}`, { apiKey: value }),
    onSuccess: () => { setValue(""); setEditing(false); setResult(null); refresh(); toast({ title: `${provider.label}: platform key saved` }); },
    onError: (e: Error) => toast({ title: "Could not save key", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/super-admin/avatar/platform/keys/${provider.id}`),
    onSuccess: () => { refresh(); toast({ title: `${provider.label}: platform key removed` }); },
    onError: (e: Error) => toast({ title: "Could not remove key", description: e.message, variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: () => apiRequest<{ ok: boolean; detail?: string; error?: string }>("POST", `/api/super-admin/avatar/platform/keys/${provider.id}/test`, editing && value ? { apiKey: value } : {}),
    onSuccess: (r) => setResult({ ok: r.ok, text: r.ok ? `Key works${r.detail ? ` (${r.detail})` : ""}` : r.error || "Key rejected" }),
    onError: (e: Error) => setResult({ ok: false, text: e.message }),
  });
  return (
    <div className="rounded-lg border p-3" data-testid={`platform-avatar-key-${provider.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4 text-gray-500" />{provider.label}</span>
        {provider.configured ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="font-mono">{provider.masked}</span>
            {provider.source === "env" && <Badge variant="secondary">from env</Badge>}
          </span>
        ) : <span className="text-xs text-gray-500">Not set</span>}
      </div>
      {editing || !provider.configured ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Platform API key" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={value.trim().length < 8 || save.isPending}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={value.trim().length < 8 || test.isPending}>Test key</Button>
            {provider.configured && <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Replace</Button>
          <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>{test.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Test key</Button>
          {provider.source === "settings" && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove.mutate()}>Remove</Button>}
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

/** Super admin settings: platform avatar keys (used only for accounts allowed to use them) + cost rates. */
export function LiveAvatarPlatformCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<PlatformView>({
    queryKey: KEY,
    queryFn: async () => {
      const res = await fetch("/api/super-admin/avatar/platform", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
  const [heygenRate, setHeygenRate] = useState("");
  const [anamRate, setAnamRate] = useState("");
  useEffect(() => {
    if (data) { setHeygenRate(String(data.rates.heygen_liveavatar ?? "")); setAnamRate(String(data.rates.anam ?? "")); }
  }, [data]);
  const saveRates = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/super-admin/avatar/platform/rates", { heygen_liveavatar: Number(heygenRate), anam: Number(anamRate) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: KEY }); toast({ title: "Avatar rates saved" }); },
    onError: (e: Error) => toast({ title: "Could not save rates", description: e.message, variant: "destructive" }),
  });
  return (
    <Card data-testid="card-live-avatar-platform">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Video className="h-5 w-5 text-purple-600" />Live AI avatar — platform keys</CardTitle>
        <CardDescription>
          Our own provider keys. An account uses them only when it has no key of its own and "Allow platform key (we pay)" is on
          in its Live AI avatar settings. Keys are encrypted and only the last 4 characters are shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading || !data ? (
          <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading…</div>
        ) : (
          <>
            {data.providers.map((p) => <PlatformKeyRow key={p.id} provider={p} />)}
            <div className="grid grid-cols-1 gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-3 sm:items-end">
              <div><Label htmlFor="rate-heygen">HeyGen cost (USD/min)</Label><Input id="rate-heygen" type="number" step="0.01" min="0" value={heygenRate} onChange={(e) => setHeygenRate(e.target.value)} /></div>
              <div><Label htmlFor="rate-anam">Anam cost (USD/min)</Label><Input id="rate-anam" type="number" step="0.01" min="0" value={anamRate} onChange={(e) => setAnamRate(e.target.value)} /></div>
              <Button onClick={() => saveRates.mutate()} disabled={saveRates.isPending}>Save rates</Button>
              <p className="text-xs text-muted-foreground sm:col-span-3">Used to estimate avatar spend in Usage & Limits (it counts toward each account's monthly AI limit).</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
