import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Globe, MessageSquare, Contact, LifeBuoy, BarChart3, Settings } from "lucide-react";
import type { MeResponseDto } from "@shared/dto";

export default function WebsiteAgent() {
  const [, setLocation] = useLocation();

  const { data: user } = useQuery<MeResponseDto>({
    queryKey: ["/api/auth/me"],
  });

  const systemMode = user?.businessAccount?.systemMode || 'full';
  const isSuperAdmin = user?.role === "super_admin";
  const isSuperAdminImpersonating = isSuperAdmin && !!user?.activeBusinessAccountId;
  const showFullFeatures = isSuperAdminImpersonating || systemMode === 'full';
  const hasSupportTicketsEnabled = user?.businessAccount?.supportTicketsEnabled === true;

  const cards = [
    {
      label: "Conversations",
      description: "Chat history",
      icon: MessageSquare,
      color: "blue",
      hoverBorder: "hover:border-blue-300",
      bg: "bg-blue-50",
      hoverBg: "group-hover:bg-blue-100",
      text: "text-blue-600",
      path: "/conversations",
      show: true,
    },
    {
      label: "Leads",
      description: "View captured leads",
      icon: Contact,
      color: "green",
      hoverBorder: "hover:border-green-300",
      bg: "bg-green-50",
      hoverBg: "group-hover:bg-green-100",
      text: "text-green-600",
      path: "/admin/leads",
      show: true,
    },
    {
      label: "Support Tickets",
      description: "Manage tickets",
      icon: LifeBuoy,
      color: "red",
      hoverBorder: "hover:border-red-300",
      bg: "bg-red-50",
      hoverBg: "group-hover:bg-red-100",
      text: "text-red-600",
      path: "/tickets",
      show: showFullFeatures && hasSupportTicketsEnabled,
    },
    {
      label: "Insights",
      description: "Performance metrics",
      icon: BarChart3,
      color: "orange",
      hoverBorder: "hover:border-orange-300",
      bg: "bg-orange-50",
      hoverBg: "group-hover:bg-orange-100",
      text: "text-orange-600",
      path: "/insights",
      show: true,
    },
    {
      label: "Widget",
      description: "Customize chat widget",
      icon: Settings,
      color: "slate",
      hoverBorder: "hover:border-slate-300",
      bg: "bg-slate-50",
      hoverBg: "group-hover:bg-slate-100",
      text: "text-slate-600",
      path: "/admin/widget-settings",
      show: true,
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
        <Globe className="w-[400px] h-[400px] text-purple-500/[0.04]" strokeWidth={1} />
      </div>

      <header className="bg-white border-b px-4 py-3 flex items-center gap-4 relative z-10">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600">
            <Globe className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold">Website</h1>
        </div>
      </header>

      <div className="p-6 relative z-10">
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {cards.filter(c => c.show).map((card) => (
              <Card
                key={card.label}
                className={`cursor-pointer hover:shadow-md ${card.hoverBorder} transition-all group`}
                onClick={() => setLocation(card.path)}
              >
                <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
                  <div className={`p-3 rounded-xl ${card.bg} ${card.hoverBg} transition-colors`}>
                    <card.icon className={`w-6 h-6 ${card.text}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{card.label}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
