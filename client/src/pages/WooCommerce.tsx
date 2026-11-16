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
import { WOO_STATUS_KEY, readModeLabel, type WebsiteDetection, type WebsiteReadMode, type WooStatus } from "@/lib/wooCommerce";
import { AlertTriangle, CheckCircle2, Globe, KeyRound, Loader2, Pencil, PlugZap, RefreshCw, ScanSearch, Unplug, XCircle } from "lucide-react";


const hoursLabel = (h: number) =>
  h === 1 ? "Every hour" : h < 24 ? `Every ${h} hours` : h === 24 ? "Once a day" : h === 168 ? "Once a week" : `Every ${h / 24} days`;

const when = (iso: string) => `${format(new Date(iso), "d MMM, h:mm a")} (${formatDistanceToNow(new Date(iso), { addSuffix: true })})`;

/**
 * Products → Website products (super admins). The website address is checked first (Shopify, WooCommerce or
 * another shop) and its products are read the way that suits it; a WooCommerce website can also be read with
 * its consumer key + secret (saved encrypted, never shown again).
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
  const [readMode, setReadMode] = useState<WebsiteReadMode>("public");
  // What "Check website" found for the address typed (cleared when the address changes).
  const [detected, setDetected] = useState<(WebsiteDetection & { success: true }) | { success: false; message: string } | null>(null);
  const useKeys = readMode === "keys";
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  // Changing the website, the way it's read or the keys while connected.
  const [editing, setEditing] = useState(false);
  // Only the first N products (a demo needs a few, not the whole catalog).
  const [limitOn, setLimitOn] = useState(false);
  const [limitN, setLimitN] = useState("50");

  useEffect(() => {
    if (!status) return;
    if (status.storeUrl) setStoreUrl(u => u || status.storeUrl!);
    setSyncHours(String(status.syncHours));
  }, [status?.storeUrl, status?.syncHours]);
  useEffect(() => {
    if (status?.readMode) setReadMode(status.readMode);
  }, [status?.readMode]);
  useEffect(() => {
    if (!status) return;
    setLimitOn(status.productLimit != null);
    if (status.productLimit != null) setLimitN(String(status.productLimit));
  }, [status?.productLimit]);

  const limitValid = !limitOn || (/^\d+$/.test(limitN.trim()) && Number(limitN) >= 1 && Number(limitN) <= 100000);
  const limitValue = limitOn && limitValid ? Number(limitN) : null;

  const readBody = () => useKeys
    ? { storeUrl, readMode: "keys", consumerKey: consumerKey.trim(), consumerSecret: consumerSecret.trim() }
    : detected?.success && detected.readMode
      ? { storeUrl: detected.storeUrl, readMode: detected.readMode }
      // Not checked yet: the server checks the website on Connect.
      : { storeUrl, readMode: "auto" };

  const detectMutation = useMutation({
    mutationFn: () => apiRequest<(WebsiteDetection & { success: true }) | { success: false; message: string }>("POST", "/api/woocommerce/detect", { storeUrl }),
    onSuccess: (r) => {
      setDetected(r);
      if (r.success && r.needsKeys && !r.readMode) setReadMode("keys");
      else if (r.success && r.readMode) setReadMode(r.readMode);
    },
    onError: (e: Error) => setDetected({ success: false, message: e.message }),
  });

  const changeUrl = (v: string) => {
    setStoreUrl(v);
    setTest(null);
    setDetected(null);
    if (!useKeys) setReadMode("public");
  };

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
    mutationFn: () => apiRequest<{ success: boolean; pending?: boolean; message: string }>("POST", "/api/woocommerce/connect", { ...readBody(), syncHours: Number(syncHours), productLimit: limitValue }),
    onSuccess: (r) => {
      setConfirm(null);
      refresh();
      if (r.success) {
        setEditing(false);
        setTest(null);
        setDetected(null);
        setConsumerKey("");
        setConsumerSecret("");
      }
      toast(r.pending ? { title: "Reading the website", description: r.message } : r.success ? { title: "Website connected", description: r.message } : { title: "Couldn't connect", description: r.message, variant: "destructive" });
    },
    onError: (e: Error) => toast({ title: "Couldn't connect", description: e.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest<{ success: boolean; pending?: boolean; message: string }>("POST", "/api/woocommerce/sync-now"),
    onSuccess: (r) => {
      refresh();
      toast(r.pending ? { title: "Reading the website", description: r.message } : r.success ? { title: "Synced", description: r.message } : { title: "Sync failed", description: r.message, variant: "destructive" });
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

  // A new limit is saved, then a sync brings the catalog in line with it.
  const limitMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/woocommerce/settings", { productLimit: limitValue }),
    onSuccess: () => syncMutation.mutate(),
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  const limitPicker = (
    <div className="space-y-1.5">
      <Label>Products to bring in</Label>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup">
        {([
          { on: false, label: "All products" },
          { on: true, label: "Only the first" },
        ]).map(o => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={limitOn === o.on}
            onClick={() => setLimitOn(o.on)}
            className={`h-9 rounded-md border px-3 text-sm transition-colors ${limitOn === o.on ? "border-purple-500 bg-purple-50 font-medium ring-1 ring-purple-500 dark:bg-purple-950/30" : "hover:bg-muted/50"}`}
            data-testid={`radio-woo-limit-${o.on ? "some" : "all"}`}
          >
            {o.label}
          </button>
        ))}
        {limitOn && (
          <span className="flex items-center gap-2 text-sm">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={100000}
              className={`h-9 w-24 ${limitValid ? "" : "border-red-400"}`}
              value={limitN}
              onChange={(e) => setLimitN(e.target.value)}
              aria-label="How many products"
              data-testid="input-woo-limit"
            />
            products
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {limitOn ? "Handy for a demo: only the first products the website lists are brought in." : "Every product on the website is brought in."}
      </p>
    </div>
  );

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
            Website products are switched off for this account. Switch them on in <Link href={SETTINGS_PATHS.features} className="text-primary underline">Features</Link> first.
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
            Type the shop's website address. We check what it's built on (Shopify, WooCommerce or another shop) and
            read its products the right way, usually from the link alone. While connected, the chat (website, WhatsApp,
            Instagram, Facebook and voice) uses only the website's products.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.connected && !editing ? (
            <>
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div>Website: <a href={status.storeUrl ?? "#"} target="_blank" rel="noreferrer" className="font-medium text-primary underline" data-testid="text-woo-store-url">{status.storeUrl}</a></div>
                <div data-testid="text-woo-read-mode">Reading: {readModeLabel(status.readMode)}</div>
                <div data-testid="text-woo-live">Live in chat: <span className="font-medium">{status.counts.website} website products</span> · {status.counts.manual} manual products kept, not used in chat</div>
                <div data-testid="text-woo-limit">Bringing in: {status.productLimit != null ? `only the first ${status.productLimit} products the website lists` : "all products"}</div>
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
                <Button variant="outline" onClick={() => { setEditing(true); setTest(null); setDetected(null); setStoreUrl(status.storeUrl || ""); }} disabled={busy} data-testid="button-woo-change">
                  <Pencil className="mr-2 h-4 w-4" /> Change website
                </Button>
                <Button variant="outline" onClick={() => setConfirm("disconnect")} disabled={busy} data-testid="button-woo-disconnect">
                  <Unplug className="mr-2 h-4 w-4" /> Disconnect
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                {limitPicker}
                {(limitValue ?? null) !== (status.productLimit ?? null) && (
                  <Button onClick={() => limitMutation.mutate()} disabled={busy || !limitValid || limitMutation.isPending} data-testid="button-woo-limit-apply">
                    {limitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Apply and sync
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="woo-url">Website address</Label>
                <div className="flex flex-wrap gap-2">
                  <Input id="woo-url" className="min-w-[14rem] flex-1" placeholder="https://example.com" value={storeUrl} onChange={(e) => changeUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && storeUrl.trim()) detectMutation.mutate(); }} data-testid="input-woo-store-url" />
                  <Button variant="outline" onClick={() => detectMutation.mutate()} disabled={!storeUrl.trim() || detectMutation.isPending} data-testid="button-woo-detect">
                    {detectMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanSearch className="mr-2 h-4 w-4" />} Check website
                  </Button>
                </div>
                {detectMutation.isPending && <p className="text-xs text-muted-foreground">Looking at the website… this can take up to a minute.</p>}
              </div>
              {detected && (
                <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${detected.success && (detected.readMode || detected.needsKeys) ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"}`} data-testid="text-woo-detect-result">
                  {detected.success && detected.readMode ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  <div className="min-w-0">
                    {detected.success && detected.platformName && <Badge variant="outline" className="mb-1 bg-white/60" data-testid="badge-woo-platform">{detected.platformName}</Badge>}
                    <div>{detected.message}</div>
                    {detected.success && (detected.total != null || detected.sample.length > 0) && (
                      <div className="mt-1 opacity-80">
                        {detected.total != null && detected.platform === "woocommerce" && `${detected.total} products. `}
                        {detected.sample.length > 0 && `For example: ${detected.sample.slice(0, 3).join(", ")}`}
                        {detected.currency ? ` · prices in ${detected.currency}` : ""}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {(useKeys || (detected?.success && detected.platform === "woocommerce") || (status.connected && status.readMode === "keys")) && (
                <label className="flex items-center gap-2 text-sm" data-testid="label-woo-use-keys">
                  <input
                    type="checkbox"
                    checked={useKeys}
                    onChange={(e) => {
                      setTest(null);
                      setReadMode(e.target.checked ? "keys" : (detected?.success && detected.readMode) || "public");
                    }}
                    className="h-4 w-4 accent-purple-600"
                    data-testid="checkbox-woo-use-keys"
                  />
                  <KeyRound className="h-4 w-4 text-purple-600" /> Use the WooCommerce keys from the website's developer
                </label>
              )}
              {useKeys && (
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
              {limitPicker}
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
              {status.syncing && (
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm" data-testid="text-woo-reading">
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading the website's products… big shops take a few minutes. You can leave this page.
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                {useKeys && (
                  <Button variant="outline" onClick={() => testMutation.mutate()} disabled={!storeUrl.trim() || testMutation.isPending} data-testid="button-woo-test">
                    {testMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Test keys
                  </Button>
                )}
                <Button onClick={() => (status.connected ? connectMutation.mutate() : setConfirm("connect"))} disabled={!storeUrl.trim() || busy || !limitValid || (!useKeys && detected?.success === true && !detected.readMode) || (!useKeys && detected?.success === false)} data-testid="button-woo-connect">
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />} {status.connected ? "Save and sync" : "Connect"}
                </Button>
                {status.connected && (
                  <Button variant="ghost" onClick={() => { setEditing(false); setTest(null); setDetected(null); setReadMode(status.readMode); setConsumerKey(""); setConsumerSecret(""); setStoreUrl(status.storeUrl || ""); }} disabled={busy} data-testid="button-woo-cancel-change">
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
                <Badge variant="secondary">{last.limit != null ? `${last.total} brought in` : `${last.total} on the website`}</Badge>
                <Badge variant="secondary">{last.added} added</Badge>
                <Badge variant="secondary">{last.updated} updated</Badge>
                <Badge variant="secondary">{last.removed} removed</Badge>
                {last.limit != null && <Badge variant="outline">first {last.limit} only</Badge>}
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
              The products on <span className="break-all">{(detected?.success && detected.storeUrl) || storeUrl.trim() || "the website"}</span> are read now{limitValue ? ` (only the first ${limitValue})` : ""}. When that works, the chat uses only those products.
              {status.counts.manual > 0 ? ` Your ${status.counts.manual} manual products are kept as they are, but not used in chat while the website is connected.` : ""}
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
            <DialogTitle>Disconnect the website?</DialogTitle>
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
