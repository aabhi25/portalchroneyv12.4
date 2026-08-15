import { useLocation, useParams, Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionBlock } from "@/components/whatsapp/WhatsAppHub";
import {
  getWhatsappSections,
  type WhatsappReadiness,
  type WhatsappSectionId,
} from "@/components/whatsapp/sections";
import type { MeResponseDto } from "@shared/dto";

/**
 * The in-screen picker one WhatsApp sidebar section opens.
 *
 * Marketing-enabled accounts collapse the sidebar to a single row per section; this page shows
 * that section's option cards (same data, same cards as the overview hub) and the cards do the
 * navigating. Nothing here owns any content of its own — it is a lens over `sections.ts`.
 */
export default function WhatsAppSectionHub() {
  const params = useParams<{ sectionId: string }>();
  const [, setLocation] = useLocation();

  const { data: user } = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });
  const { data: readiness } = useQuery<WhatsappReadiness>({
    queryKey: ["/api/whatsapp/readiness"],
  });

  const marketingEnabled =
    user?.businessAccount?.whatsappEnabled === true &&
    user?.businessAccount?.whatsappMarketingEnabled === true;

  const sections = getWhatsappSections({ marketingEnabled });
  const section = sections.find(s => s.id === (params.sectionId as WhatsappSectionId));

  // Unknown section — or Campaigns requested by an account without marketing. The overview
  // page is the correct fallback either way; a 404 would strand the user.
  if (user && !section) {
    return <Redirect to="/admin/whatsapp" />;
  }
  if (!section) return null; // user still loading

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground -ml-2"
        onClick={() => setLocation("/admin/whatsapp")}
        data-testid="button-back-to-whatsapp"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        WhatsApp overview
      </Button>

      <SectionBlock section={section} readiness={readiness} onOpen={href => setLocation(href)} />
    </div>
  );
}
