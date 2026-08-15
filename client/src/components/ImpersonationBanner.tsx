import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { LogOut, Eye } from "lucide-react";

interface ImpersonationStatusResponse {
  isImpersonating: boolean;
  impersonating: {
    businessAccountId: string;
    businessAccountName: string;
  } | null;
}

export function ImpersonationBanner() {
  const { data: status } = useQuery<ImpersonationStatusResponse>({
    queryKey: ["/api/super-admin/impersonate/status"],
    staleTime: 30000,
  });

  const exitMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest<{ success: boolean; message: string }>(
        "POST",
        "/api/super-admin/impersonate/exit"
      );
    },
    onSuccess: () => {
      sessionStorage.removeItem("lastPath");
      // Everything cached belongs to the account being exited. Invalidating a couple of keys
      // leaves the rest to render under the next account, so drop the lot and reload — the
      // same thing AccountSwitcher does when it changes account.
      queryClient.clear();
      window.location.href = "/super-admin";
    },
  });

  if (!status?.isImpersonating || !status.impersonating) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-3 py-1 flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-1.5">
        <Eye className="h-3 w-3" />
        <span className="text-xs font-medium">
          Viewing as: <strong>{status.impersonating.businessAccountName}</strong>
        </span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => exitMutation.mutate()}
        disabled={exitMutation.isPending}
        className="h-5 text-[10px] px-2 bg-white/20 hover:bg-white/30 text-white border-0"
      >
        <LogOut className="h-2.5 w-2.5 mr-0.5" />
        {exitMutation.isPending ? "Exiting..." : "Exit View"}
      </Button>
    </div>
  );
}
