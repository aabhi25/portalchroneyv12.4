import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, Copy, Link2, Loader2, Trash2 } from "lucide-react";

interface Candidate {
  businessAccountId: string;
  name: string;
  whatsappEnabled: boolean;
  hasOwnNumber: boolean;
  linkedHere: boolean;
  linkedElsewhere: boolean;
  sharesItsOwn: boolean;
}

interface SharedNumberData {
  usesSharedNumber: boolean;
  ready: boolean;
  number: string | null;
  linked: { businessAccountId: string; name: string; tag: string; landingPageLink: string | null }[];
  candidates: Candidate[];
}

/** Why a group account can't be linked right now, or null when it can. */
function blockedReason(c: Candidate): string | null {
  if (!c.whatsappEnabled) return "WhatsApp is off for this account";
  if (c.linkedElsewhere) return "uses another account's number";
  if (c.sharesItsOwn) return "shares its own number";
  return null;
}

export function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(link).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

/**
 * Owner side of a shared WhatsApp number (super admins): which accounts use this account's number,
 * and the link each one's landing pages should use.
 */
export function SharedNumberCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SharedNumberData>({ queryKey: ["/api/whatsapp/shared-number"] });
  const [pick, setPick] = useState("");
  const [confirm, setConfirm] = useState<Candidate | null>(null);
  const [stopOpen, setStopOpen] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/shared-number"] });
    queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/settings"] });
  };
  const link = useMutation({
    mutationFn: (accountId: string) => apiRequest("POST", "/api/whatsapp/shared-number/links", { accountId }),
    onSuccess: () => { setPick(""); setConfirm(null); refresh(); toast({ title: "Account linked", description: "It now sends and receives on this number." }); },
    onError: (e: Error) => { setConfirm(null); toast({ title: "Couldn't link the account", description: e.message, variant: "destructive" }); },
  });
  const unlink = useMutation({
    mutationFn: (accountId: string) => apiRequest("DELETE", `/api/whatsapp/shared-number/links/${accountId}`),
    onSuccess: () => { refresh(); toast({ title: "Account removed", description: "It uses its own WhatsApp details again." }); },
    onError: (e: Error) => toast({ title: "Couldn't remove the account", description: e.message, variant: "destructive" }),
  });
  const stop = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/whatsapp/shared-number"),
    onSuccess: () => { setStopOpen(false); refresh(); toast({ title: "Stopped sharing this number" }); },
    onError: (e: Error) => toast({ title: "Couldn't stop sharing", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <Card><CardContent className="pt-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading shared number…</CardContent></Card>;
  }
  if (data.usesSharedNumber) return null;

  const available = data.candidates.filter((c) => !c.linkedHere);
  const options = available.map((c) => {
    const reason = blockedReason(c);
    return { value: c.businessAccountId, label: reason ? `${c.name} (${reason})` : c.name };
  });
  const chosen = available.find((c) => c.businessAccountId === pick) ?? null;
  const chosenBlocked = chosen ? blockedReason(chosen) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-green-600" /> Shared number</CardTitle>
        <CardDescription>
          Let other accounts in this account group use this WhatsApp number. Each keeps its own AI replies, journeys,
          leads and CRM. Messages are sent to the right account by the website chat code, the landing-page link, a campaign
          reply or an earlier chat; anything else comes to this account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.ready && (
          <p className="text-sm text-amber-700">Save this account's MSG91 Auth Key, WhatsApp Number and Integrated Number ID first.</p>
        )}

        {data.linked.length > 0 && (
          <div className="divide-y rounded-lg border">
            {data.linked.map((l) => (
              <div key={l.businessAccountId} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">{l.name}</p>
                  <p className="text-xs text-gray-500">Landing-page tag <span className="font-mono">({l.tag})</span></p>
                </div>
                {l.landingPageLink && <CopyLinkButton link={l.landingPageLink} />}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${l.name}`}
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate(l.businessAccountId)}
                >
                  <Trash2 className="h-4 w-4 text-gray-500" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full max-w-sm">
            <SearchableSelect
              value={pick}
              onValueChange={setPick}
              placeholder={available.length ? "Add an account" : "No other accounts in this group"}
              searchPlaceholder="Search accounts…"
              emptyMessage="No account with that name"
              options={options}
            />
          </div>
          <Button
            disabled={!data.ready || !chosen || !!chosenBlocked || link.isPending}
            onClick={() => (chosen?.hasOwnNumber ? setConfirm(chosen) : chosen && link.mutate(chosen.businessAccountId))}
          >
            {link.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Link account
          </Button>
        </div>
        {chosenBlocked && <p className="text-xs text-amber-700">{chosen?.name}: {chosenBlocked}.</p>}

        <p className="text-xs text-gray-500">
          Paste each account's link into the WhatsApp icon on its landing pages. The tag at the end of the message tells us which
          account the student came from. "Stop" from a student stops messages from every linked account.
        </p>

        {data.linked.length > 0 && (
          <Button variant="outline" size="sm" className="text-red-600" onClick={() => setStopOpen(true)}>Stop sharing this number</Button>
        )}
      </CardContent>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Link {confirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.name} has its own WhatsApp number. Once linked it sends and receives on this number instead; its own
              details stay saved and come back if you remove it. Messages to its own number stop reaching the portal while it is linked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && link.mutate(confirm.businessAccountId)}>Link account</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={stopOpen} onOpenChange={setStopOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop sharing this number?</AlertDialogTitle>
            <AlertDialogDescription>
              All {data.linked.length} linked account{data.linked.length === 1 ? "" : "s"} go back to their own WhatsApp details.
              Every message to this number then comes to this account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => stop.mutate()}>Stop sharing</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
