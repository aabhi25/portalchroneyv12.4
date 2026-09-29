import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Users, MessageCircle, MessageSquareText, Route, BarChart3, Settings, Camera, Square, Zap, type LucideIcon } from "lucide-react";
import { SOCIAL_CHANNELS, type SocialChannel } from "./channelConfig";

const FACEBOOK_LOGO_PATH = "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z";

interface Tile {
  page: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  /** Tailwind colour name for the hover border / icon tint. */
  color: string;
}

const TILES: Tile[] = [
  { page: "leads", title: "Leads", subtitle: "View captured leads", icon: Users, color: "green" },
  { page: "conversations", title: "Conversations", subtitle: "Chat history", icon: MessageCircle, color: "blue" },
  { page: "flows", title: "AI Flows", subtitle: "Automated workflows", icon: Route, color: "purple" },
  { page: "insights", title: "Insights", subtitle: "Performance metrics", icon: BarChart3, color: "orange" },
  { page: "comments", title: "Comment Replies", subtitle: "Auto-reply history", icon: MessageSquareText, color: "teal" },
  { page: "smart-replies", title: "Smart Replies", subtitle: "Keyword-triggered responses", icon: Zap, color: "amber" },
  { page: "settings", title: "Config", subtitle: "Settings & credentials", icon: Settings, color: "slate" },
];

// Full class names (Tailwind only keeps classes it can see verbatim).
const TILE_CLASSES: Record<string, { card: string; bg: string; icon: string }> = {
  green: { card: "hover:border-green-300", bg: "bg-green-50 group-hover:bg-green-100", icon: "text-green-600" },
  blue: { card: "hover:border-blue-300", bg: "bg-blue-50 group-hover:bg-blue-100", icon: "text-blue-600" },
  purple: { card: "hover:border-purple-300", bg: "bg-purple-50 group-hover:bg-purple-100", icon: "text-purple-600" },
  orange: { card: "hover:border-orange-300", bg: "bg-orange-50 group-hover:bg-orange-100", icon: "text-orange-600" },
  teal: { card: "hover:border-teal-300", bg: "bg-teal-50 group-hover:bg-teal-100", icon: "text-teal-600" },
  amber: { card: "hover:border-amber-300", bg: "bg-amber-50 group-hover:bg-amber-100", icon: "text-amber-600" },
  slate: { card: "hover:border-slate-300", bg: "bg-slate-50 group-hover:bg-slate-100", icon: "text-slate-600" },
};

/** Landing page for /admin/instagram and /admin/facebook: one tile per section. */
export default function ChannelHome({ channel }: { channel: SocialChannel }) {
  const c = SOCIAL_CHANNELS[channel];
  const [, setLocation] = useLocation();
  const isInstagram = channel === "instagram";

  return (
    <div className="min-h-screen bg-gray-50 relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
        {isInstagram
          ? <Camera className="w-[400px] h-[400px] text-pink-500/[0.04]" strokeWidth={1} />
          : <Square className="w-[400px] h-[400px] text-blue-500/[0.04]" strokeWidth={1} />}
      </div>
      <header className="bg-white border-b px-4 py-3 flex items-center gap-4 relative z-10">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          {isInstagram ? (
            <div className="p-1 rounded-lg bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400">
              <Camera className="w-4 h-4 text-white" />
            </div>
          ) : (
            <div className="p-1 rounded-lg bg-gradient-to-br from-blue-600 to-blue-500">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d={FACEBOOK_LOGO_PATH} />
              </svg>
            </div>
          )}
          <h1 className="text-lg font-semibold">{c.label}</h1>
        </div>
      </header>

      <div className="p-6 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {TILES.map((tile) => {
            const cls = TILE_CLASSES[tile.color];
            const Icon = tile.icon;
            return (
              <Card
                key={tile.page}
                className={`cursor-pointer hover:shadow-md ${cls.card} transition-all group`}
                onClick={() => setLocation(c.adminPath(tile.page))}
                data-testid={`tile-${channel}-${tile.page}`}
              >
                <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
                  <div className={`p-3 rounded-xl ${cls.bg} transition-colors`}>
                    <Icon className={`w-6 h-6 ${cls.icon}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{tile.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{tile.subtitle}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
