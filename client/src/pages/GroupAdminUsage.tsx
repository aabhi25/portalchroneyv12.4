import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UsageDashboard } from "@/components/usage/UsageDashboard";

/** Group admin AI usage page (/group-admin/usage): pick one of the group's accounts. */
export default function GroupAdminUsage() {
  const { data, isLoading } = useQuery<{ accounts: Array<{ id: string; name: string }> }>({
    queryKey: ["/api/group-admin/usage/accounts"],
    staleTime: 5 * 60_000,
  });
  const accounts = data?.accounts ?? [];
  const [accountId, setAccountId] = useState<string>("");
  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  return (
    <div className="flex flex-col flex-1 min-h-screen bg-gray-50">
      <header className="hidden lg:flex items-center h-[56px] px-6 border-b bg-white">
        <SidebarTrigger className="-ml-1 mr-2" />
        <h1 className="text-[15px] font-semibold text-gray-900">AI Usage</h1>
      </header>
      <div className="max-w-6xl w-full mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        <div className="w-full sm:w-72">
          <label className="text-sm font-medium text-gray-700 mb-2 block">Account</label>
          <Select value={accountId} onValueChange={setAccountId} disabled={accounts.length === 0}>
            <SelectTrigger data-testid="select-usage-account">
              <SelectValue placeholder={isLoading ? "Loading…" : "No accounts available"} />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {!isLoading && accounts.length === 0 && (
          <p className="text-sm text-muted-foreground">You don't have analytics access to any account group.</p>
        )}
        {accountId && <UsageDashboard businessAccountId={accountId} />}
      </div>
    </div>
  );
}
