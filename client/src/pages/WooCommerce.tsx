import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SETTINGS_PATHS } from "@/pages/settings/settingsPaths";
import { WOO_STATUS_KEY, type WooStatus } from "@/lib/wooCommerce";
import { AlertTriangle, CheckCircle2, Globe, KeyRound, Link2, Loader2, Pencil, PlugZap, RefreshCw, Unplug, XCircle } from "lucide-react";


const hoursLabel = (h: number) =>
  h === 1 ? "Every hour" : h < 24 ? `Every ${h} hours` : h === 24 ? "Once a day" : h === 168 ? "Once a week" : `Every ${h / 24} days`;

const when = (iso: string) => `${format(new Date(iso), "d MMM, h:mm a")} (${formatDistanceToNow(new Date(iso), { addSuffix: true })})`;

/**
 * Products → WooCommerce (super admins). Reads the website's public product list (no keys), or the
 * WooCommerce API with the website's consumer key + secret (saved encrypted, never shown again).
 * While connected the chat uses only the website's products; manual products are kept but not used.
 */
export default function WooCommerce() {
  const { toast } = useToast();
  const { data: status, isLoading } = useQuery<WooStatus>({
    queryKey: WOO_STATUS_KEY,
    refetchInterval: (q) => (q.state.data?.syncing ? 3000 : false),
  });
  const [storeUrl, setStoreUrl] = useState("");
  const [syncHours, setSyncHours] = useState("24");
  const [test, setTest] = useState<{ success: boolean; message: string; sample?: string[]; currency?: string | null } | null>(null);
  const [confirm, setConfirm] = useState<"connect" | "disconnect" | null>(null);
  const [readMode, setReadMode] = useState<"public" | "keys">("public");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  // Changing the website, the way it's read or the keys while connected.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!status) return;
    if (status.storeUrl) setStoreUrl(u => u || status.storeUrl!);
    setSyncHours(String(status.syncHours));
  }, [status?.storeUrl, status?.syncHours]);
  useEffect(() => {
    if (status?.readMode) setReadMode(status.readMode);
  }, [status?.readMode]);

  const readBody = () => readMode === "keys"
    ? { storeUrl, readMode, consumerKey: consumerKey.trim(), consumerSecret: consumerSecret.trim() }
    : { storeUrl, readMode };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: WOO_STATUS_KEY });
    queryClient.invalidateQueries({ queryKey: ["/api/products"] });
  };

  const testMutation = useMutation({
    mutationFn: () => apiRequest<{ success: boolean; message: string; sample?: string[]; currency?: string | null }>("POST", "/api/woocommerce/test", readBody()),
    onSuccess: (r) => setTest(r),
    onError: (e: Error) => setTest({ success: false, message: e.message }),
  });

  const connectMutation = useMutation({
    mutationFn: () => apiRequest<{ success: boolean; message: string }>("POST", "/api/woocommerce/connect", { ...readBody(), syncHours: Number(syncHours) }),
    onSuccess: (r) => {
      setConfirm(null);
      refresh();
      if (r.success) {
        setEditing(false);
        setTest(null);
        setConsumerKey("");
        setConsumerSecret("");
      }
      toast(r.success ? { title: "WooCommerce connected", description: r.message } : { title: "Couldn't connect", description: r.message, variant: "destructive" });
    },
    onError: (e: Error) => toast({ title: "Couldn't connect", description: e.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest<{ success: boolean; message: string }>("POST", "/api/woocommerce/sync-now"),
    onSuccess: (r) => {
      refresh();
      toast(r.success ? { title: "Synced", description: r.message } : { title: "Sync failed", description: r.message, variant: "destructive" });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const hoursMutation = useMutation({
    mutationFn: (hours: number) => apiRequest("PUT", "/api/woocommerce/settings", { syncHours: hours }),
    onSuccess: () => {
      refresh();
      toast({ title: "Saved", description: "Sync timing updated." });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest<{ success: boolean; message: string }>("POST", "/api/woocommerce/disconnect"),
    onSuccess: (r) => {
      setConfirm(null);
      refresh();
      toast({ title: "Disconnected", description: r.message });
    },
    onError: (e: Error) => toast({ title: "Couldn't disconnect", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !status) {
    return <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  if (!status.featureOn) {
    return (
      <div className="max-w-3xl p-1" data-testid="woocommerce-page">
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            WooCommerce is switched off for this account. Switch it on in <Link href={SETTINGS_PATHS.features} className="text-primary underline">Features</Link> first.
          </CardContent>
        </Card>
      </div>
    );
  }

  const last = status.lastResult;
  const busy = status.syncing || syncMutation.isPending || connectMutation.isPending;
  const hourChoices = status.syncHourChoices?.length ? status.syncHourChoices : [24];
  const currencyMismatch = !!(last?.currency && status.chatCurrency && last.currency !== status.chatCurrency);

  return (
    <div className="max-w-3xl space-y-6 p-1" data-testid="woocommerce-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe className="h-5 w-5 text-purple-600" /> Website
            {status.connected
              ? <Badge className="ml-1 bg-emerald-600 hover:bg-emerald-600" data-testid="badge-woo-connected">Connected</Badge>
              : <Badge variant="secondary" className="ml-1" data-testid="badge-woo-not-connected">Not connected</Badge>}
          </CardTitle>
          <CardDescription>
            Products are read from the website: from its public product list (just the website link), or with the
            WooCommerce keys from the website's developer. While connected, the chat (website, WhatsApp, Instagram,
            Facebook and voice) uses only the website's products.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.connected && !editing ? (
            <>
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div>Website: <a href={status.storeUrl ?? "#"} target="_blank" rel="noreferrer" className="font-medium text-primary underline" data-testid="text-woo-store-url">{status.storeUrl}</a></div>
                <div data-testid="text-woo-read-mode">Reading: {status.readMode === "keys" ? "with the website's keys (saved encrypted)" : "the public product list (no keys)"}</div>
                <div data-testid="text-woo-live">Live in chat: <span className="font-medium">{status.counts.website} website products</span> · {status.counts.manual} manual products kept, not used in chat</div>
                {status.lastSyncedAt && <div className="text-muted-foreground">Last good sync: {when(status.lastSyncedAt)}</div>}
                {status.nextSyncAt && !status.syncing && <div className="text-muted-foreground">Next sync: {format(new Date(status.nextSyncAt), "d MMM, h:mm a")}</div>}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label>Re-read the website</Label>
                  <Select value={syncHours} onValueChange={(v) => { setSyncHours(v); hoursMutation.mutate(Number(v)); }}>
                    <SelectTrigger className="w-48" data-testid="select-woo-sync-hours"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {hourChoices.map(h => <SelectItem key={h} value={String(h)}>{hoursLabel(h)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={() => syncMutation.mutate()} disabled={busy} data-testid="button-woo-sync-now">
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  {busy ? "Syncing…" : "Sync now"}
                </Button>
                <Button variant="outline" onClick={() => { setEditing(true); setTest(null); setStoreUrl(status.storeUrl || ""); }} disabled={busy} data-testid="button-woo-change">
                  <Pencil className="mr-2 h-4 w-4" /> Change website or keys
                </Button>
                <Button variant="outline" onClick={() => setConfirm("disconnect")} disabled={busy} data-testid="button-woo-disconnect">
                  <Unplug className="mr-2 h-4 w-4" /> Disconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="woo-url">Website address</Label>
                <Input id="woo-url" placeholder="https://example.com" value={storeUrl} onChange={(e) => { setStoreUrl(e.target.value); setTest(null); }} data-testid="input-woo-store-url" />
              </div>
              <div className="space-y-1.5">
                <Label>How to read the products</Label>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                  {([
                    { mode: "public" as const, icon: Link2, title: "Website link only", text: "Reads the public product list that shoppers see. No keys needed." },
                    { mode: "keys" as const, icon: KeyRound, title: "Website link + keys", text: "Uses the WooCommerce keys from the website's developer. Also works if the public list is switched off or blocked." },
                  ]).map(o => (
                    <button
                      key={o.mode}
                      type="button"
                      role="radio"
                      aria-checked={readMode === o.mode}
                      onClick={() => { setReadMode(o.mode); setTest(null); }}
                      className={`rounded-md border p-3 text-left text-sm transition-colors ${readMode === o.mode ? "border-purple-500 bg-purple-50 ring-1 ring-purple-500 dark:bg-purple-950/30" : "hover:bg-muted/50"}`}
                      data-testid={`radio-woo-mode-${o.mode}`}
                    >
                      <div className="flex items-center gap-2 font-medium"><o.icon className="h-4 w-4 text-purple-600" /> {o.title}</div>
                      <div className="mt-1 text-muted-foreground">{o.text}</div>
                    </button>
                  ))}
                </div>
              </div>
              {readMode === "keys" && (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="woo-key">Consumer key</Label>
                      <Input id="woo-key" type="password" autoComplete="off" placeholder={status.hasKeys ? "Saved (leave empty to keep)" : "ck_…"} value={consumerKey} onChange={(e) => { setConsumerKey(e.target.value); setTest(null); }} data-testid="input-woo-consumer-key" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="woo-secret">Consumer secret</Label>
                      <Input id="woo-secret" type="password" autoComplete="off" placeholder={status.hasKeys ? "Saved (leave empty to keep)" : "cs_…"} value={consumerSecret} onChange={(e) => { setConsumerSecret(e.target.value); setTest(null); }} data-testid="input-woo-consumer-secret" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Made on the website in WooCommerce › Settings › Advanced › REST API. Read access is enough. The keys are saved
                    encrypted when Connect works, and are never shown again.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Re-read the website</Label>
                <Select value={syncHours} onValueChange={setSyncHours}>
                  <SelectTrigger className="w-48" data-testid="select-woo-sync-hours"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {hourChoices.map(h => <SelectItem key={h} value={String(h)}>{hoursLabel(h)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {test && (
                <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${test.success ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"}`} data-testid="text-woo-test-result">
                  {test.success ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                  <div>
                    <div>{test.message}</div>
                    {test.success && !!test.sample?.length && <div className="mt-1 opacity-80">For example: {test.sample.slice(0, 3).join(", ")}{test.currency ? ` · prices in ${test.currency}` : ""}</div>}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={() => testMutation.mutate()} disabled={!storeUrl.trim() || testMutation.isPending} data-testid="button-woo-test">
                  {testMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Test connection
                </Button>
                <Button onClick={() => (status.connected ? connectMutation.mutate() : setConfirm("connect"))} disabled={!storeUrl.trim() || busy} data-testid="button-woo-connect">
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />} {status.connected ? "Save and sync" : "Connect"}
                </Button>
                {status.connected && (
                  <Button variant="ghost" onClick={() => { setEditing(false); setTest(null); setReadMode(status.readMode); setConsumerKey(""); setConsumerSecret(""); setStoreUrl(status.storeUrl || ""); }} disabled={busy} data-testid="button-woo-cancel-change">
                    Cancel
                  </Button>
                )}
              </div>
              {status.connected && (
                <p className="text-sm text-muted-foreground">The new settings are saved only if the sync works; until then the current connection keeps running.</p>
              )}
              {!status.connected && status.counts.website > 0 && (
                <p className="text-sm text-muted-foreground">{status.counts.website} website products from an earlier connection are kept (not used in chat). Connecting again refreshes them.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {currencyMismatch && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="text-woo-currency-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          The website's prices are in {last!.currency}, but the chat shows prices as {status.chatCurrency}. Change the currency in the website chat settings so prices show correctly.
        </div>
      )}

      {last && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Last sync</CardTitle>
            <CardDescription>{when(last.at)} · {last.trigger === "scheduled" ? "automatic" : last.trigger === "connect" ? "on connect" : "Sync now"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {last.ok ? (
              <div className="flex flex-wrap gap-2" data-testid="text-woo-last-result">
                <Badge variant="secondary">{last.total} on the website</Badge>
                <Badge variant="secondary">{last.added} added</Badge>
                <Badge variant="secondary">{last.updated} updated</Badge>
                <Badge variant="secondary">{last.removed} removed</Badge>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" data-testid="text-woo-last-error">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div>{last.error}</div>
                  {status.connected && <div className="mt-1 opacity-80">Nothing was changed. The chat keeps using the products from the last good sync{status.lastSyncedAt ? ` (${format(new Date(status.lastSyncedAt), "d MMM, h:mm a")})` : ""}.</div>}
                </div>
              </div>
            )}
            {!!last.problems?.length && (
              <div className="space-y-1">
                <div className="font-medium">Products that couldn't be saved</div>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {last.problems.map((p, i) => <li key={i}>{p.name}: {p.message}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={confirm === "connect"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Use the website's products in chat?</DialogTitle>
            <DialogDescription>
              The products on {storeUrl.trim() || "the website"} are read now. When that works, the chat uses only those products.
              {status.counts.manual > 0 ? ` Your ${status.counts.manual} manual products are kept as they are, but not used in chat while WooCommerce is connected.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending} data-testid="button-woo-connect-confirm">
              {connectMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm === "disconnect"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect WooCommerce?</DialogTitle>
            <DialogDescription>
              The chat goes back to your {status.counts.manual} manual products straight away. The {status.counts.website} website products
              are kept, greyed out, so connecting again is quick. Automatic syncs stop.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending} data-testid="button-woo-disconnect-confirm">
              {disconnectMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
