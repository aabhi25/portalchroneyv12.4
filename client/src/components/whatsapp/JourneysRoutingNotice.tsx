import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SETTINGS_PATHS } from "@/pages/settings/settingsPaths";
import type { WhatsappReadiness } from "./sections";

/**
 * Shown above the journey list: the two rules that decide whether a journey answers at all.
 * Both are set somewhere else (reply mode in Settings, AI replies on each campaign), so without
 * this a journey can sit there switched on and never run, with nothing on screen saying why.
 */
export function JourneysRoutingNotice() {
  const [, setLocation] = useLocation();
  const { data: r } = useQuery<WhatsappReadiness>({ queryKey: ["/api/whatsapp/readiness"] });
  if (!r) return null;

  const smartAi = r.responseMode === "smart_ai";
  if (!smartAi && !r.marketing) return null;

  return (
    <div className="space-y-2" data-testid="journeys-routing-notice">
      {smartAi && (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1">
            <span className="font-medium">Journeys are not running.</span> Your reply mode is Smart AI, so the AI
            answers every message and no journey starts.
          </p>
          <Button size="sm" variant="outline" className="border-amber-300 bg-white" onClick={() => setLocation(SETTINGS_PATHS.whatsappAiReplies)}>
            Change reply mode
          </Button>
        </div>
      )}
      {r.marketing && (
        <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <p className="min-w-0 flex-1">
            Someone who replies to a campaign that has AI replies switched on gets that campaign's AI, not your
            journey. Campaigns with AI replies off leave the reply to your journeys.
          </p>
        </div>
      )}
    </div>
  );
}
