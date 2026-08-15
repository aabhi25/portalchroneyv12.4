import { useParams, Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  getWhatsappSections,
  whatsappSectionEntryHref,
  type WhatsappSectionId,
} from "@/components/whatsapp/sections";
import type { MeResponseDto } from "@shared/dto";

/**
 * Legacy landing route for a WhatsApp sidebar section (`/admin/whatsapp-hub/:sectionId`).
 *
 * The card-grid picker that used to live here was replaced by the persistent in-screen panel
 * (WhatsAppSectionPanel), so this route now just forwards to the section's last-used screen —
 * kept so old links and bookmarks still land somewhere sensible.
 */
export default function WhatsAppSectionHub() {
  const params = useParams<{ sectionId: string }>();
  const { data: user } = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });

  if (!user) return null; // still loading; the app resolves auth before rendering routes

  const marketingEnabled =
    user.businessAccount?.whatsappEnabled === true &&
    user.businessAccount?.whatsappMarketingEnabled === true;

  const sections = getWhatsappSections({ marketingEnabled });
  const section = sections.find(s => s.id === (params.sectionId as WhatsappSectionId));

  if (!section) return <Redirect to="/admin/whatsapp" />;
  return <Redirect to={whatsappSectionEntryHref(section)} />;
}
