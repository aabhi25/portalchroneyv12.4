import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, Trophy } from "lucide-react";

export interface VariantArm {
  variant: "A" | "B";
  templateId: string | null;
  templateName: string | null;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
}

export interface CampaignVariants {
  splitPercent: number | null;
  arms: VariantArm[];
}

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/**
 * A/B test results for one campaign: sent, delivered, read and replied per message.
 * Reads the `variants` field of the campaign detail API (shared cache with the detail
 * page) and renders nothing when the campaign has no A/B test.
 */
export function CampaignVariantsCard({ campaignId, variants: given }: { campaignId: string; variants?: CampaignVariants | null }) {
  const { data } = useQuery<{ variants?: CampaignVariants | null }>({
    queryKey: [`/api/whatsapp/campaigns/${campaignId}`],
    enabled: given === undefined,
  });
  const variants = given !== undefined ? given : data?.variants;
  if (!variants || variants.arms.length === 0) return null;

  const [a, b] = [variants.arms.find(x => x.variant === "A"), variants.arms.find(x => x.variant === "B")];
  const rate = (arm?: VariantArm) => (arm ? pct(arm.replied, arm.sent) : 0);
  const enough = (a?.sent ?? 0) >= 20 && (b?.sent ?? 0) >= 20;
  const leader = enough && a && b && rate(a) !== rate(b) ? (rate(a) > rate(b) ? "A" : "B") : null;
  const split = variants.splitPercent;

  return (
    <Card data-testid="card-campaign-variants">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-violet-600" /> A/B test
          {split ? <span className="text-sm font-normal text-gray-500">A {100 - split}% · B {split}%</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[a, b].filter(Boolean).map(arm => {
            const x = arm!;
            return (
              <div key={x.variant} className={`rounded-lg border p-3 ${leader === x.variant ? "border-emerald-300 bg-emerald-50/50" : "border-gray-200"}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">Message {x.variant}</p>
                    <p className="truncate text-xs text-gray-500">{x.templateName || "Template removed"}</p>
                  </div>
                  {leader === x.variant && <Badge className="gap-1 bg-emerald-600"><Trophy className="h-3 w-3" /> More replies</Badge>}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                  <Stat label="Sent" value={x.sent} />
                  <Stat label="Delivered" value={x.delivered} hint={`${pct(x.delivered, x.sent)}%`} />
                  <Stat label="Read" value={x.read} hint={`${pct(x.read, x.sent)}%`} />
                  <Stat label="Replied" value={x.replied} hint={`${pct(x.replied, x.sent)}%`} />
                </dl>
                {x.failed > 0 && <p className="mt-2 text-xs text-red-600">{x.failed} not delivered</p>}
              </div>
            );
          })}
        </div>
        {!enough && <p className="text-xs text-gray-500">Wait until each message has reached at least 20 people before picking a winner.</p>}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{value.toLocaleString()} {hint && <span className="text-xs font-normal text-gray-500">{hint}</span>}</dd>
    </div>
  );
}
