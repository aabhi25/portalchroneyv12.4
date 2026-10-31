import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Eye } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import type { MeResponseDto } from "@shared/dto";

/** Shown while an agency login has one of its clients' portals open. */
export function AgencyViewingBanner({ user }: { user: MeResponseDto }) {
  const viewing = user.agency?.viewingClient;
  const back = useMutation({
    mutationFn: () => apiRequest("POST", "/api/agency/exit-client"),
    onSuccess: () => {
      sessionStorage.removeItem("lastPath");
      // Everything cached belongs to the client; start clean on the agency side.
      queryClient.clear();
      window.location.href = "/agency";
    },
  });
  if (!viewing) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-teal-700 px-3 py-1 text-white shadow-sm" data-testid="agency-viewing-banner">
      <div className="flex min-w-0 items-center gap-1.5">
        <Eye className="h-3 w-3 shrink-0" />
        <span className="truncate text-xs font-medium">You're working in {viewing.name} for {user.agency!.agencyName}</span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs text-white hover:bg-white/20 hover:text-white"
        onClick={() => back.mutate()}
        disabled={back.isPending}
        data-testid="button-agency-back"
      >
        <ArrowLeft className="mr-1 h-3 w-3" />Back to clients
      </Button>
    </div>
  );
}
