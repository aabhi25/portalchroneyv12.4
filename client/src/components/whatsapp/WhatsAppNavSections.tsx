import { SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { ChevronRight } from "lucide-react";
import { getWhatsappSections, whatsappSectionEntryHref } from "./sections";

/**
 * The WhatsApp sections, rendered as flat sidebar rows.
 *
 * Each row navigates to the section's last-used screen; the in-screen section panel
 * (WhatsAppSectionPanel) then renders beside the content so the user can switch screens
 * without going back to the sidebar. This layout applies to all WhatsApp accounts —
 * marketing-enabled accounts additionally see the Campaigns section, but the rendering
 * mode is identical.
 */
export function WhatsAppNavSections({
  marketingEnabled,
  location,
  onNavigate,
}: {
  marketingEnabled: boolean;
  location: string;
  onNavigate: (href: string) => void;
}) {
  const sections = getWhatsappSections({ marketingEnabled });

  return (
    <>
      {sections.map(section => {
        const isActive = section.items.some(i => i.matches(location));
        return (
          <SidebarMenuItem key={section.id}>
            <SidebarMenuButton
              onClick={() => onNavigate(whatsappSectionEntryHref(section))}
              data-testid={`nav-section-${section.id}`}
              aria-label={`${section.label} section`}
              className={`group/nav transition-all duration-200 ${
                isActive
                  ? "text-purple-700 font-medium bg-purple-50/50"
                  : "hover:bg-gray-50/80"
              }`}
            >
              <ChevronRight className="w-3.5 h-3.5 shrink-0 text-gray-400" />
              <span className="text-[13px] font-medium uppercase tracking-wide text-gray-600">
                {section.label}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </>
  );
}
