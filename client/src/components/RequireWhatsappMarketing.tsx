import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { MeResponseDto } from "@shared/dto";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Megaphone, Loader2 } from "lucide-react";

/**
 * Route guard for the WhatsApp Marketing pages.
 *
 * The campaign, template and contact group APIs are already gated server-side, so without
 * this the pages render for an account that lacks the feature and then fail with a stream of
 * 403s — which reads as a broken app rather than a feature that simply isn't switched on.
 *
 * Fails closed: anything other than a confirmed-enabled account gets the explanatory state.
 */
export function RequireWhatsappMarketing({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const { data: currentUser, isLoading } = useQuery<MeResponseDto>({
    queryKey: ["/api/auth/me"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const businessAccount = currentUser?.businessAccount;
  const enabled =
    businessAccount?.whatsappEnabled === true &&
    businessAccount?.whatsappMarketingEnabled === true;

  if (!enabled) {
    return (
      <div className="p-6">
        <Card className="max-w-lg mx-auto mt-12">
          <CardContent className="pt-6 flex flex-col items-center gap-4 text-center">
            <div className="p-3 rounded-xl bg-emerald-50">
              <Megaphone className="w-6 h-6 text-emerald-600" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-base">WhatsApp Marketing isn't enabled</h3>
              <p className="text-sm text-muted-foreground">
                Campaigns, templates and contact groups aren't available for this business
                account. Ask your administrator to enable WhatsApp Marketing.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setLocation("/admin/whatsapp")}
              data-testid="button-back-to-whatsapp"
            >
              Back to WhatsApp
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
