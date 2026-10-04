import { useState } from "react";
import { SidebarMenuItem, SidebarMenuButton, SidebarMenuSub } from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, Phone } from "lucide-react";
import { CALLING_NAV_ITEMS, isCallingLocation } from "./callingSections";

function SubRows({ location, onNavigate }: { location: string; onNavigate: (href: string) => void }) {
  return (
    <>
      {CALLING_NAV_ITEMS.map(item => {
        const active = item.matches(location);
        return (
          <SidebarMenuItem key={item.key}>
            <SidebarMenuButton
              onClick={() => onNavigate(item.href)}
              data-testid={item.testId}
              className={`group/nav transition-all duration-200 ${active ? "text-purple-700 font-medium bg-purple-50/50" : "hover:bg-gray-50/80"}`}
            >
              <item.icon className={`w-3.5 h-3.5 shrink-0 ${active ? "text-purple-600" : "text-gray-400"}`} />
              <span className="text-[13px]">{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </>
  );
}

/** "Phone calls" in the AI Agents group: a collapsible row like WhatsApp. */
export function CallingNavGroupItem({ location, onNavigate }: { location: string; onNavigate: (href: string) => void }) {
  const active = isCallingLocation(location);
  const [open, setOpen] = useState(() => active);
  return (
    <SidebarMenuItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={active}
            data-testid="link-phone-calls"
            aria-label={open ? "Collapse Phone calls" : "Expand Phone calls"}
            className={`group/nav relative transition-all duration-200 ${
              active ? "bg-gradient-to-r from-purple-50 to-indigo-50 text-purple-700 font-medium shadow-sm border border-purple-100/60" : "hover:bg-gray-50/80"
            }`}
          >
            <div className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-200 ${active ? "bg-gradient-to-br from-sky-500 to-indigo-600" : "bg-gray-100 group-hover/nav:bg-gray-200/80"}`}>
              <Phone className={`w-3.5 h-3.5 transition-colors ${active ? "text-white" : "text-gray-500 group-hover/nav:text-gray-700"}`} />
            </div>
            <span className="text-[14px]">Phone calls</span>
            <ChevronRight className={`ml-auto w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            <SubRows location={location} onNavigate={onNavigate} />
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

/** Flat rows, for an account whose only AI agent is phone calls. */
export function CallingNavFlat({ location, onNavigate }: { location: string; onNavigate: (href: string) => void }) {
  return <SubRows location={location} onNavigate={onNavigate} />;
}
