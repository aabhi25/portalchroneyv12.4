import { useLocation } from "wouter";
import { Link2, Sparkles, ClipboardList, Percent, Lightbulb, LayoutGrid, MoreHorizontal } from "lucide-react";

const tabs = [
  { label: "More Features", path: "/admin/more", icon: MoreHorizontal },
  { label: "CRM", path: "/admin/crm", icon: Link2, matchPaths: ["/admin/crm", "/admin/leadsquared", "/admin/salesforce", "/admin/custom-crm"] },
  { label: "Chroney IQ", path: "/ai-insights", icon: Sparkles },
  { label: "Gaps", path: "/question-bank", icon: ClipboardList },
  { label: "Smart Discounts", path: "/admin/smart-discounts", icon: Percent },
  { label: "Guidance", path: "/guidance-campaigns", icon: Lightbulb },
  { label: "Menu Builder", path: "/admin/menu-builder", icon: LayoutGrid },
];

export default function MoreFeaturesNavTabs() {
  const [location, setLocation] = useLocation();

  return (
    <div className="bg-white border-b px-4 py-2 flex items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.matchPaths
          ? tab.matchPaths.includes(location)
          : location === tab.path;
        const Icon = tab.icon;
        return (
          <button
            key={tab.path}
            onClick={() => setLocation(tab.path)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              isActive
                ? "bg-purple-50 text-purple-700 shadow-sm"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            <Icon className={`w-4 h-4 ${isActive ? "text-purple-600" : "text-gray-400"}`} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
