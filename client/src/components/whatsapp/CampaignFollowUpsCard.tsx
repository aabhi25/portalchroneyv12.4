import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BellRing } from "lucide-react";

export interface FollowUpStepSummary {
  id: string;
  stepNumber: number;
  delayHours: number;
  templateId: string;
  templateName: string | null;
  enabled: boolean;
  sent: number;
  failed: number;
  skipped: number;
  inProgress: number;
  /** Step 1 only: people who got the first message, haven't replied, and haven't had the reminder yet. */
  waiting: number | null;
}

const hours = (h: number) => (h % 24 === 0 && h >= 24 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`);

/**
 * Reminder ("follow-up") status for one campaign. Renders nothing when the campaign has no
 * follow-up. `isLive` (sending / finished) switches on a gentle refresh.
 */
export function CampaignFollowUpsCard({ campaignId, isLive = false }: { campaignId: string; isLive?: boolean }) {
  const { data } = useQuery<{ steps: FollowUpStepSummary[] }>({
    queryKey: [`/api/whatsapp/campaigns/${campaignId}/follow-ups`],
    refetchInterval: isLive ? 60_000 : false,
  });
  const steps = data?.steps ?? [];
  if (steps.length === 0) return null;

  return (
    <Card data-testid="card-campaign-follow-ups">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="h-4 w-4 text-amber-600" /> Reminders
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map(s => (
          <div key={s.id} className="rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-800">
                {steps.length > 1 && <span className="font-semibold">Reminder {s.stepNumber}: </span>}
                If no reply within <span className="font-medium">{hours(s.delayHours)}</span>, send{" "}
                <span className="font-medium">{s.templateName || "a removed template"}</span>
              </p>
              {!s.enabled && <Badge variant="outline">Off</Badge>}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-4">
              <Item label="Sent" value={s.sent} className="text-emerald-700" />
              {s.waiting !== null && <Item label="Still waiting" value={s.waiting} />}
              <Item label="Skipped" value={s.skipped} hint="replied late or opted out" />
              <Item label="Not delivered" value={s.failed} className={s.failed ? "text-red-600" : undefined} />
            </dl>
            {s.inProgress > 0 && <p className="mt-2 text-xs text-gray-500">{s.inProgress} being sent right now.</p>}
          </div>
        ))}
        <p className="text-xs text-gray-500">Reminders stop for anyone who replies or opts out, and follow the campaign's quiet hours.</p>
      </CardContent>
    </Card>
  );
}

function Item({ label, value, hint, className }: { label: string; value: number; hint?: string; className?: string }) {
  return (
    <div title={hint}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`font-medium ${className || "text-gray-900"}`}>{value.toLocaleString()}</dd>
    </div>
  );
}
