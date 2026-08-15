import { useLocation } from "wouter";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Users, MessagesSquare, Route, BarChart3, MessageSquareText, Camera } from "lucide-react";

const tabs = [
  { key: "leads", label: "Leads", icon: Users, path: "/admin/instagram-leads" },
  { key: "conversations", label: "Conversations", icon: MessagesSquare, path: "/admin/instagram-conversations" },
  { key: "flows", label: "AI Flows", icon: Route, path: "/admin/instagram-flows" },
  { key: "comments", label: "Comments", icon: MessageSquareText, path: "/admin/instagram-comments" },
  { key: "insights", label: "Insights", icon: BarChart3, path: "/admin/instagram-insights" },
];

interface InstagramTabBarProps {
  activeTab: string;
}

export default function InstagramTabBar({ activeTab }: InstagramTabBarProps) {
  const [, setLocation] = useLocation();

  return (
    <>
      <header className="bg-white border-b px-4 py-3 flex items-center gap-3">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <Camera className="h-6 w-6 text-pink-500" />
          <h1 className="text-lg font-semibold">Instagram</h1>
        </div>
      </header>
      <nav className="bg-white border-b px-4 relative z-10">
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.key === activeTab;
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setLocation(tab.path)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? "border-pink-500 text-pink-700"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <TabIcon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
