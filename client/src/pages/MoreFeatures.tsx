import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutGrid, Sparkles, ClipboardList, Percent, Lightbulb, Link2 } from "lucide-react";

const features = [
  {
    id: "crm",
    title: "CRM",
    description: "Connect your CRM to automatically sync leads captured by Chroney",
    icon: Link2,
    path: "/admin/crm",
    color: "bg-purple-100",
    iconColor: "text-purple-600",
  },
  {
    id: "chroney-iq",
    title: "Chroney IQ",
    description: "AI-powered insights and analytics for your conversations",
    icon: Sparkles,
    path: "/ai-insights",
    color: "bg-purple-100",
    iconColor: "text-purple-600",
  },
  {
    id: "gaps",
    title: "Gaps",
    description: "Track unanswered questions and knowledge base gaps",
    icon: ClipboardList,
    path: "/question-bank",
    color: "bg-orange-100",
    iconColor: "text-orange-600",
  },
  {
    id: "smart-discounts",
    title: "Smart Discounts",
    description: "Configure dynamic discount offers for your customers",
    icon: Percent,
    path: "/admin/smart-discounts",
    color: "bg-green-100",
    iconColor: "text-green-600",
  },
  {
    id: "guidance",
    title: "Guidance",
    description: "Create proactive guidance campaigns for visitors",
    icon: Lightbulb,
    path: "/guidance-campaigns",
    color: "bg-yellow-100",
    iconColor: "text-yellow-600",
  },
  {
    id: "menu-builder",
    title: "Menu Builder",
    description: "Create visual navigation menus for your chat widget",
    icon: LayoutGrid,
    path: "/admin/menu-builder",
    color: "bg-indigo-100",
    iconColor: "text-indigo-600",
  },
];

export default function MoreFeatures() {
  const [, setLocation] = useLocation();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">More Features</h1>
        <p className="text-muted-foreground mt-1">
          Additional tools and settings to enhance your workspace
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((feature) => (
          <Card
            key={feature.id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setLocation(feature.path)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${feature.color}`}>
                  <feature.icon className={`w-5 h-5 ${feature.iconColor}`} />
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription>{feature.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
