import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { LogOut, Eye } from "lucide-react";
import type { MeResponseDto } from "@shared/dto";
import { setBusinessUserView } from "@/lib/businessUserView";

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
  const { data: me } = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });
  const businessView = me?.viewingAsBusinessUser === true;

  const exitMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest<{ success: boolean; message: string }>(
        "POST",
        "/api/super-admin/impersonate/exit"
      );
    },
    onSuccess: () => {
      sessionStorage.removeItem("lastPath");
      setBusinessUserView(null);
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
  const accountId = status.impersonating.businessAccountId;

  // Reload so every page, menu and cached answer is rebuilt for the chosen view.
  const switchView = (toBusiness: boolean) => {
    if (toBusiness === businessView) return;
    setBusinessUserView(toBusiness ? accountId : null);
    window.location.reload();
  };
  const pill = (active: boolean) =>
    `rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${active ? "bg-white text-orange-600" : "text-white/90 hover:bg-white/20"}`;

  return (
    <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-3 py-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 shadow-sm">
      <div className="flex items-center gap-1.5 min-w-0">
        <Eye className="h-3 w-3 shrink-0" />
        <span className="text-xs font-medium truncate">
          Viewing as: <strong>{status.impersonating.businessAccountName}</strong>
        </span>
      </div>
      <div className="flex items-center gap-0.5 rounded-full bg-white/15 p-0.5 sm:ml-auto" role="group" aria-label="How to show this account">
        <button type="button" className={pill(!businessView)} aria-pressed={!businessView} onClick={() => switchView(false)} data-testid="button-super-admin-view">
          Super admin view
        </button>
        <button type="button" className={pill(businessView)} aria-pressed={businessView} onClick={() => switchView(true)} data-testid="button-business-user-view" title="See the portal exactly as this account's own login does">
          Business user view
        </button>
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
