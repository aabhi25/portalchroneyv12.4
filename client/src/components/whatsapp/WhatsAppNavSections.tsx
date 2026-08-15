import { useEffect, useState } from "react";
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { getWhatsappSections, whatsappSectionEntryHref, type WhatsappSection } from "./sections";

/**
 * The three WhatsApp sections, rendered as expandable sidebar rows.
 *
 * Emitted as bare list items so the same component can be dropped into the top level of the
 * sidebar (accounts that only have WhatsApp) or nested underneath the WhatsApp entry (accounts
 * running several AI agents). Those two layouts used to be written out separately and had already
 * drifted; there is now one implementation and one source of membership.
 *
 * A section row expands and collapses — it does not navigate anywhere. There is no such thing as
 * a "Lead Gen page"; the section is a grouping, and giving it a destination would invent a screen
 * that has to be maintained and would compete with the overview page.
 */

function SectionRow({
  section,
  location,
  onNavigate,
  open,
  onOpenChange,
}: {
  section: WhatsappSection;
  location: string;
  onNavigate: (href: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const hasActiveChild = section.items.some(i => i.matches(location));

  // The list item wraps the Collapsible, not the other way round: these rows are rendered into
  // a <ul>, and Radix's Collapsible root is a <div>, which is not valid there.
  return (
    <SidebarMenuItem>
      <Collapsible open={open} onOpenChange={onOpenChange} className="group/section">
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            data-testid={`nav-section-${section.id}`}
            aria-label={`${section.label} section`}
            className={`group/nav transition-all duration-200 ${
              hasActiveChild && !open
                ? "text-purple-700 font-medium bg-purple-50/50"
                : "hover:bg-gray-50/80"
            }`}
          >
            <ChevronRight
              className={`w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform duration-200 ${
                open ? "rotate-90" : ""
              }`}
            />
            <span className="text-[13px] font-medium uppercase tracking-wide text-gray-600">
              {section.label}
            </span>
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <SidebarMenuSub>
            {section.items.map(item => {
              const Icon = item.icon;
              const isActive = item.matches(location);
              return (
                <SidebarMenuSubItem key={item.key}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={isActive}
                    className="cursor-pointer h-8"
                    data-testid={item.sidebarTestId}
                  >
                    <button
                      type="button"
                      onClick={() => onNavigate(item.href)}
                      className="w-full text-left"
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

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
  const activeSectionId = sections.find(s => s.items.some(i => i.matches(location)))?.id ?? null;

  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(activeSectionId ? [activeSectionId] : []),
  );

  // Landing on a screen inside a collapsed section opens it, so the sidebar always shows where
  // you currently are. Sections the user opened by hand stay open.
  useEffect(() => {
    if (!activeSectionId) return;
    setOpenIds(prev => (prev.has(activeSectionId) ? prev : new Set(prev).add(activeSectionId)));
  }, [activeSectionId]);

  // Marketing-enabled accounts have the most sections and sub-items, and nesting them all made
  // the sidebar cramped enough to truncate labels. For those accounts each section is a single
  // row that opens the section's last-used screen with an in-screen panel of the sub-options
  // alongside; other accounts keep the expandable list.
  if (marketingEnabled) {
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

  return (
    <>
      {sections.map(section => (
        <SectionRow
          key={section.id}
          section={section}
          location={location}
          onNavigate={onNavigate}
          open={openIds.has(section.id)}
          onOpenChange={next =>
            setOpenIds(prev => {
              const copy = new Set(prev);
              if (next) copy.add(section.id);
              else copy.delete(section.id);
              return copy;
            })
          }
        />
      ))}
    </>
  );
}
