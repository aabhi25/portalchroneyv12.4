import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Users, MessageCircle, MessageSquareText, Route, BarChart3, Settings, Camera, Zap } from "lucide-react";

export default function InstagramHome() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-gray-50 relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
        <Camera className="w-[400px] h-[400px] text-pink-500/[0.04]" strokeWidth={1} />
      </div>
      <header className="bg-white border-b px-4 py-3 flex items-center gap-4 relative z-10">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400">
            <Camera className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold">Instagram</h1>
        </div>
      </header>

      <div className="p-6 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card
            className="cursor-pointer hover:shadow-md hover:border-green-300 transition-all group"
            onClick={() => setLocation("/admin/instagram-leads")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-green-50 group-hover:bg-green-100 transition-colors">
                <Users className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Leads</h3>
                <p className="text-xs text-muted-foreground mt-1">View captured leads</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-blue-300 transition-all group"
            onClick={() => setLocation("/admin/instagram-conversations")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-blue-50 group-hover:bg-blue-100 transition-colors">
                <MessageCircle className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Conversations</h3>
                <p className="text-xs text-muted-foreground mt-1">Chat history</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-purple-300 transition-all group"
            onClick={() => setLocation("/admin/instagram-flows")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-purple-50 group-hover:bg-purple-100 transition-colors">
                <Route className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">AI Flows</h3>
                <p className="text-xs text-muted-foreground mt-1">Automated workflows</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-orange-300 transition-all group"
            onClick={() => setLocation("/admin/instagram-insights")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-orange-50 group-hover:bg-orange-100 transition-colors">
                <BarChart3 className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Insights</h3>
                <p className="text-xs text-muted-foreground mt-1">Performance metrics</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-teal-300 transition-all group"
            onClick={() => setLocation("/admin/instagram-comments")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-teal-50 group-hover:bg-teal-100 transition-colors">
                <MessageSquareText className="w-6 h-6 text-teal-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Comment Replies</h3>
                <p className="text-xs text-muted-foreground mt-1">Auto-reply history</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-amber-300 transition-all group"
            onClick={() => setLocation("/admin/instagram-smart-replies")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-amber-50 group-hover:bg-amber-100 transition-colors">
                <Zap className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Smart Replies</h3>
                <p className="text-xs text-muted-foreground mt-1">Keyword-triggered responses</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-slate-300 transition-all group"
            onClick={() => setLocation("/admin/instagram-settings")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-slate-50 group-hover:bg-slate-100 transition-colors">
                <Settings className="w-6 h-6 text-slate-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Config</h3>
                <p className="text-xs text-muted-foreground mt-1">Settings & credentials</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
