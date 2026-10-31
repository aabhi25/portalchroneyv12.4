import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CredentialsDialog, Panel, StatusPill, UsageBar, formatUsd } from "@/components/agency/agencyUi";
import { agencyHref } from "@/navigation/superAdminAreas";

interface AgencyRow {
  id: string;
  name: string;
  status: string;
  brandName: string;
  accounts: number;
  maxAccounts: number | null;
  logins: number;
  monthlyAiCapUsd: number | null;
  aiCapAction: string;
  spentUsd: number;
}

/** Super admin › Customers › Agencies: every reseller agency, and creating a new one. */
export default function SuperAdminAgencies() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ month: string; usdInrRate: number; agencies: AgencyRow[] }>({ queryKey: ["/api/super-admin/agencies"] });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [created, setCreated] = useState<{ id: string; credentials: { username: string; tempPassword: string } | null } | null>(null);

  const create = useMutation({
    mutationFn: () => apiRequest<{ agency: { id: string }; credentials: { username: string; tempPassword: string } | null }>(
      "POST", "/api/super-admin/agencies", { name, ownerEmail },
    ),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/agencies"] });
      setOpen(false);
      setName("");
      setOwnerEmail("");
      if (res.credentials) setCreated({ id: res.agency.id, credentials: res.credentials });
      else setLocation(agencyHref(res.agency.id, "plan"));
    },
    onError: (e: Error) => toast({ title: "Couldn't create the agency", description: e.message, variant: "destructive" }),
  });

  const list = data?.agencies ?? [];
  return (
    <>
      <Panel
        subtitle="Digital marketing agencies that resell the product to their own clients, each with its own plan, limits, price and brand."
        actions={<Button onClick={() => setOpen(true)} data-testid="button-new-agency"><Plus className="mr-1 h-4 w-4" />New agency</Button>}
      >
        {isLoading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : list.length === 0 ? (
          <div className="rounded-xl bg-gray-50 px-4 py-8 text-center">
            <p className="text-[14px] font-medium text-gray-900">No agencies yet</p>
            <p className="mt-1 text-[13px] text-gray-500">Create one, choose what it may resell and set its AI cap. Then give its owner the login.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-black/[0.06] text-[12px] text-gray-500">
                  <th className="py-2 pr-3 font-medium">Agency</th>
                  <th className="py-2 pr-3 font-medium">Clients</th>
                  <th className="py-2 pr-3 font-medium">Logins</th>
                  <th className="py-2 pr-3 font-medium">AI this month</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {list.map(a => {
                  const pct = a.monthlyAiCapUsd ? Math.round((a.spentUsd / a.monthlyAiCapUsd) * 1000) / 10 : null;
                  return (
                    <tr
                      key={a.id}
                      className="cursor-pointer border-b border-black/[0.04] last:border-0 hover:bg-gray-50"
                      onClick={() => setLocation(agencyHref(a.id))}
                      data-testid={`row-agency-${a.id}`}
                    >
                      <td className="py-3 pr-3">
                        <p className="font-medium text-gray-900">{a.name}</p>
                        {a.brandName !== a.name && <p className="text-[12px] text-gray-500">Sells as {a.brandName}</p>}
                      </td>
                      <td className="py-3 pr-3 tabular-nums">{a.accounts}{a.maxAccounts !== null ? ` of ${a.maxAccounts}` : ""}</td>
                      <td className="py-3 pr-3 tabular-nums">{a.logins}</td>
                      <td className="py-3 pr-3">
                        <p className="tabular-nums">{formatUsd(a.spentUsd, data?.usdInrRate, "INR")}{a.monthlyAiCapUsd !== null ? ` of ${formatUsd(a.monthlyAiCapUsd)}` : ""}</p>
                        {pct !== null && <div className="mt-1 w-32"><UsageBar percent={pct} /></div>}
                      </td>
                      <td className="py-3 pr-3"><StatusPill status={a.status} /></td>
                      <td className="py-3 text-right"><ChevronRight className="ml-auto h-4 w-4 text-gray-400" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New agency</DialogTitle>
            <DialogDescription>It starts with the usual resellable features and no AI cap. You can change everything on its page.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="agency-name">Agency name</Label>
              <Input id="agency-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. BrightLeaf Digital" autoFocus data-testid="input-agency-name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agency-owner">Owner's login email <span className="font-normal text-gray-500">(optional)</span></Label>
              <Input id="agency-owner" type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="owner@agency.com" data-testid="input-agency-owner" />
              <p className="text-[12px] text-gray-500">The owner can create clients and add staff logins, if the agency's plan allows it.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!name.trim() || create.isPending} data-testid="button-create-agency">
                {create.isPending ? "Creating…" : "Create agency"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CredentialsDialog
        credentials={created?.credentials ?? null}
        title="Agency created"
        onClose={() => { const id = created?.id; setCreated(null); if (id) setLocation(agencyHref(id, "plan")); }}
      />
    </>
  );
}
