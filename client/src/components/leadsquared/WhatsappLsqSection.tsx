import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Copy, Loader2, TableProperties } from "lucide-react";

export interface WhatsappLsqData {
  connection: "same" | "own";
  mappings: "same" | "own";
  connectionType: "uds" | "api";
  udsWebhookUrl: string;
  hasUdsKey: boolean;
  accessKey: string;
  hasSecretKey: boolean;
  region: string;
  customHost: string;
  configured: boolean;
  ownMappingsCount: number;
  autoSyncOn: boolean;
}

export const WHATSAPP_LSQ_KEY = ["/api/leadsquared/whatsapp"];

/** One line for the overview card. */
export function whatsappLsqSummary(d: WhatsappLsqData | undefined): string {
  if (!d) return "Loading…";
  if (d.connection === "same" && d.mappings === "same") return "Same connection and field mappings as website leads";
  return [
    d.connection === "own" ? "Own connection" : "Website connection",
    d.mappings === "own" ? `own mappings (${d.ownMappingsCount} field${d.ownMappingsCount === 1 ? "" : "s"})` : "website mappings",
  ].join(" · ");
}

/**
 * WhatsApp leads → LeadSquared: use the website connection and field mappings, or WhatsApp's own.
 * `onEditMappings` opens the usual mapping editor on WhatsApp's own list.
 */
export function WhatsappLsqSection({ onEditMappings }: { onEditMappings: () => void }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<WhatsappLsqData>({ queryKey: WHATSAPP_LSQ_KEY });
  const [form, setForm] = useState<WhatsappLsqData | null>(null);
  const [udsKey, setUdsKey] = useState("");
  const [secretKey, setSecretKey] = useState("");

  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest<{ copiedMappings: number | null }>("POST", "/api/leadsquared/whatsapp", body),
    onSuccess: (r) => {
      setUdsKey(""); setSecretKey("");
      queryClient.invalidateQueries({ queryKey: WHATSAPP_LSQ_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/leadsquared/settings"] });
      toast({
        title: "Saved",
        description: r?.copiedMappings != null
          ? `WhatsApp leads now have their own field mappings, starting from a copy of the ${r.copiedMappings} website ones.`
          : "WhatsApp LeadSquared settings saved.",
      });
    },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
  const recopy = useMutation({
    mutationFn: () => apiRequest<{ copied: number }>("POST", "/api/leadsquared/whatsapp/copy-website-mappings"),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: WHATSAPP_LSQ_KEY });
      toast({ title: "Copied", description: `WhatsApp mappings replaced with the ${r.copied} website mappings.` });
    },
    onError: (e: Error) => toast({ title: "Couldn't copy", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !form) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  const set = (patch: Partial<WhatsappLsqData>) => setForm({ ...form, ...patch });
  const saveConnection = () => save.mutate({
    connection: form.connection,
    connectionType: form.connectionType,
    udsWebhookUrl: form.udsWebhookUrl,
    udsKey: udsKey || undefined,
    accessKey: form.accessKey,
    secretKey: secretKey || undefined,
    region: form.region,
    customHost: form.customHost,
  });

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Connection for WhatsApp leads</CardTitle>
          <CardDescription>Where WhatsApp leads are sent in LeadSquared.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup value={form.connection} onValueChange={(v) => set({ connection: v as "same" | "own" })} className="space-y-2">
            <div className="flex items-start gap-2">
              <RadioGroupItem value="same" id="wa-conn-same" className="mt-0.5" />
              <Label htmlFor="wa-conn-same" className="font-normal">Same as website leads <span className="text-muted-foreground">(the Connection Settings card)</span></Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="own" id="wa-conn-own" className="mt-0.5" />
              <Label htmlFor="wa-conn-own" className="font-normal">Its own connection</Label>
            </div>
          </RadioGroup>

          {form.connection === "own" && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-2">
                <Label>Connection method</Label>
                <Select value={form.connectionType} onValueChange={(v) => set({ connectionType: v as "uds" | "api" })}>
                  <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="uds">Universal Data Sync (UDS)</SelectItem>
                    <SelectItem value="api">LeadSquared API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.connectionType === "uds" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="wa-uds-url">UDS webhook link</Label>
                    <Input id="wa-uds-url" value={form.udsWebhookUrl} onChange={(e) => set({ udsWebhookUrl: e.target.value })} placeholder="https://… (from the Custom / HTTPS trigger of the UDS flow)" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wa-uds-key">UDS key (ickey)</Label>
                    <Input id="wa-uds-key" type="password" value={udsKey} onChange={(e) => setUdsKey(e.target.value)} placeholder={form.hasUdsKey ? "•••••••• (saved, leave blank to keep it)" : "Optional if it's already in the link"} />
                  </div>
                </>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="wa-access">Access key</Label>
                    <Input id="wa-access" value={form.accessKey} onChange={(e) => set({ accessKey: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wa-secret">Secret key</Label>
                    <Input id="wa-secret" type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={form.hasSecretKey ? "•••••••• (saved, leave blank to keep it)" : ""} />
                  </div>
                  <div className="space-y-2">
                    <Label>Region</Label>
                    <Select value={form.region || ""} onValueChange={(v) => set({ region: v })}>
                      <SelectTrigger><SelectValue placeholder="Choose region" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="india">India</SelectItem>
                        <SelectItem value="us">US</SelectItem>
                        <SelectItem value="other">Other (custom host)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.region === "other" && (
                    <div className="space-y-2">
                      <Label htmlFor="wa-host">API host</Label>
                      <Input id="wa-host" value={form.customHost} onChange={(e) => set({ customHost: e.target.value })} placeholder="api-xx.leadsquared.com" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={saveConnection} disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Save connection
            </Button>
            {data?.configured && <span className="inline-flex items-center gap-1 text-sm text-green-700"><CheckCircle2 className="h-4 w-4" /> WhatsApp leads can be sent</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Field mappings for WhatsApp leads</CardTitle>
          <CardDescription>Which details go into which LeadSquared field for WhatsApp leads.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={data?.mappings ?? "same"}
            onValueChange={(v) => save.mutate({ mappings: v })}
            className="space-y-2"
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem value="same" id="wa-map-same" className="mt-0.5" />
              <Label htmlFor="wa-map-same" className="font-normal">Same as website leads <span className="text-muted-foreground">(the Field Mappings card)</span></Label>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="own" id="wa-map-own" className="mt-0.5" />
              <Label htmlFor="wa-map-own" className="font-normal">Their own mappings <span className="text-muted-foreground">(starts from a copy of the website ones)</span></Label>
            </div>
          </RadioGroup>
          {data?.mappings === "own" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={onEditMappings}>
                <TableProperties className="h-4 w-4 mr-1.5" />
                Edit WhatsApp mappings ({data.ownMappingsCount} field{data.ownMappingsCount === 1 ? "" : "s"})
              </Button>
              <Button variant="ghost" size="sm" disabled={recopy.isPending} onClick={() => recopy.mutate()}>
                <Copy className="h-4 w-4 mr-1.5" /> Start again from the website mappings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        WhatsApp leads are sent automatically when <strong>Auto-sync to LeadSquared</strong> is on in WhatsApp → Settings → Number &amp; connection
        {data?.autoSyncOn ? " (it is on)." : " (it is off: leads are only sent with Sync on the Leads page)."}
      </p>
    </div>
  );
}
