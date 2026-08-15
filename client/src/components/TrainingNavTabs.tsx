import { useLocation } from "wouter";
import { Brain, Route, HelpCircle, Building2, FileText, Globe, GraduationCap, Zap } from "lucide-react";

const tabs = [
  { label: "Training", path: "/admin/training", icon: GraduationCap },
  { label: "Train Chroney", path: "/train-chroney", icon: Brain },
  { label: "Journeys", path: "/conversation-journeys", icon: Route },
  { label: "FAQs", path: "/admin/faqs", icon: HelpCircle },
  { label: "Website Scan", path: "/admin/about", icon: Building2 },
  { label: "Scan Docs", path: "/admin/scan-docs", icon: FileText },
  { label: "Scan URLs", path: "/admin/url-training", icon: Globe },
  { label: "Smart Replies", path: "/admin/smart-replies", icon: Zap },
];

export default function TrainingNavTabs() {
  const [location, setLocation] = useLocation();

  return (
    <div className="bg-white border-b px-4 py-2 flex items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = location === tab.path;
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
