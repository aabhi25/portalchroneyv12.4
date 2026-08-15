import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Globe, MessageSquare, Contact, BarChart3, LifeBuoy } from "lucide-react";
import type { MeResponseDto } from "@shared/dto";

interface WebsiteNavTabsProps {
  hideHeader?: boolean;
}

export default function WebsiteNavTabs({ hideHeader }: WebsiteNavTabsProps) {
  const [location, setLocation] = useLocation();

  const { data: user } = useQuery<MeResponseDto>({
    queryKey: ["/api/auth/me"],
  });

  const systemMode = user?.businessAccount?.systemMode || 'full';
  const isSuperAdmin = user?.role === "super_admin";
  const isSuperAdminImpersonating = isSuperAdmin && !!user?.activeBusinessAccountId;
  const showFullFeatures = isSuperAdminImpersonating || systemMode === 'full';
  const hasSupportTicketsEnabled = user?.businessAccount?.supportTicketsEnabled === true;

  const tabs = [
    { key: "conversations", label: "Conversations", icon: MessageSquare, path: "/conversations" },
    { key: "leads", label: "Leads", icon: Contact, path: "/admin/leads" },
    { key: "insights", label: "Insights", icon: BarChart3, path: "/insights" },
    ...(showFullFeatures && hasSupportTicketsEnabled
      ? [{ key: "tickets", label: "Tickets", icon: LifeBuoy, path: "/tickets" }]
      : []),
  ];

  const getActiveKey = () => {
    if (location === "/conversations") return "conversations";
    if (location === "/admin/leads") return "leads";
    if (location === "/insights") return "insights";
    if (location === "/tickets" || location.startsWith("/tickets/")) return "tickets";
    return "";
  };

  const activeKey = getActiveKey();

  return (
    <div className="relative z-10">
      {!hideHeader && (
        <header className="bg-white border-b px-3 py-1.5 flex items-center gap-3">
          <SidebarTrigger />
          <div className="flex items-center gap-1.5">
            <div className="p-0.5 rounded bg-gradient-to-br from-violet-500 to-purple-600">
              <Globe className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-sm font-semibold">Website</h1>
          </div>
        </header>
      )}
      <nav className="bg-white border-b px-3">
        <div className="flex items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = activeKey === tab.key;
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setLocation(tab.path)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-purple-500 text-purple-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <TabIcon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
