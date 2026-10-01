import { useQuery } from "@tanstack/react-query";
import { Video } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AvatarStatus {
  enabled: boolean;
  provider?: string;
  displayName?: string | null;
  key?: "set" | "not set";
  minutesUsed?: number;
  monthlyMinuteCap?: number;
  maxSessionMinutes?: number;
}

/** Read-only for business users: the Live AI avatar add-on is managed by the Chroney team. */
export function LiveAvatarStatusCard() {
  const { data } = useQuery<AvatarStatus>({
    queryKey: ["/api/avatar/status"],
    queryFn: async () => {
      const res = await fetch("/api/avatar/status", { credentials: "include" });
      if (!res.ok) return { enabled: false };
      return res.json();
    },
    staleTime: 60_000,
  });
  if (!data) return null;
  return (
    <Card className="shadow-lg border border-gray-200 bg-white" data-testid="card-live-avatar-status">
      <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
        <CardTitle className="text-lg flex items-center gap-2"><Video className="h-5 w-5" /> Live AI avatar</CardTitle>
        <CardDescription>A lip-synced video avatar for voice conversations. Managed by the Chroney team — contact us to change it.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4 text-sm space-y-1">
        {data.enabled ? (
          <>
            <p><span className="font-medium">Status:</span> On{data.displayName ? ` — "${data.displayName}"` : ""}</p>
            <p><span className="font-medium">Provider:</span> {data.provider}</p>
            <p><span className="font-medium">Key:</span> {data.key}</p>
            <p><span className="font-medium">This month:</span> {data.minutesUsed ?? 0} of {data.monthlyMinuteCap} minutes · calls up to {data.maxSessionMinutes} min</p>
          </>
        ) : (
          <p className="text-gray-600">Not enabled for this account.</p>
        )}
      </CardContent>
    </Card>
  );
}
