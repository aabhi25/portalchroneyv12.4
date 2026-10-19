import { useLocation } from "wouter";
import { HideInHub } from "@/components/hub/HideInHub";
import { useHubAccess, usesHubLayout } from "@/components/hub/HubFrame";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { LucideIcon } from "lucide-react";
import { Brain, Route, HelpCircle, Building2, FileText, Globe, GraduationCap, Zap, ShieldCheck, Lightbulb, MessageCircleQuestion } from "lucide-react";
import { hubArea, visibleTabs } from "@/navigation/hubAreas";
import type { MeResponseDto } from "@shared/dto";

interface Tile {
  key: string;
  label: string;
  href: string;
}

/** Icon, colour and one-line description for each Training tab, keyed by the tab's key. */
const TILE_LOOK: Record<string, { icon: LucideIcon; text: string; tile: string; hover: string; description: string }> = {
  instructions: { icon: Brain, text: "text-purple-600", tile: "bg-purple-50 group-hover:bg-purple-100", hover: "hover:border-purple-300", description: "How your AI talks and what it should know" },
  faqs: { icon: HelpCircle, text: "text-green-600", tile: "bg-green-50 group-hover:bg-green-100", hover: "hover:border-green-300", description: "Common questions and their answers" },
  website: { icon: Building2, text: "text-orange-600", tile: "bg-orange-50 group-hover:bg-orange-100", hover: "hover:border-orange-300", description: "Learn from your whole website" },
  links: { icon: Globe, text: "text-indigo-600", tile: "bg-indigo-50 group-hover:bg-indigo-100", hover: "hover:border-indigo-300", description: "Learn from individual web pages" },
  documents: { icon: FileText, text: "text-teal-600", tile: "bg-teal-50 group-hover:bg-teal-100", hover: "hover:border-teal-300", description: "Upload PDFs and other documents" },
  journeys: { icon: Route, text: "text-blue-600", tile: "bg-blue-50 group-hover:bg-blue-100", hover: "hover:border-blue-300", description: "Guided questions, asked in the chat" },
  suggestions: { icon: Lightbulb, text: "text-amber-600", tile: "bg-amber-50 group-hover:bg-amber-100", hover: "hover:border-amber-300", description: "Ideas to improve answers, from real chats" },
  gaps: { icon: MessageCircleQuestion, text: "text-rose-600", tile: "bg-rose-50 group-hover:bg-rose-100", hover: "hover:border-rose-300", description: "Questions your AI couldn't answer yet" },
  "keyword-replies": { icon: Zap, text: "text-amber-600", tile: "bg-amber-50 group-hover:bg-amber-100", hover: "hover:border-amber-300", description: "Fixed answers for exact words" },
  guardrails: { icon: ShieldCheck, text: "text-cyan-600", tile: "bg-cyan-50 group-hover:bg-cyan-100", hover: "hover:border-cyan-300", description: "Tutor content controls" },
};

/**
 * Training › Overview: one card per Training tab, in the same order and with the same names, so
 * the cards and the tabs above them always agree.
 */
export default function TrainingHome() {
  const [, setLocation] = useLocation();
  const { data: user } = useQuery<MeResponseDto>({ queryKey: ['/api/auth/me'] });
  const access = useHubAccess(user);
  const isK12Education = user?.businessAccount?.k12EducationEnabled === true;

  const tiles: Tile[] = visibleTabs(hubArea("training"), access).filter(t => t.key !== "overview");
  // Accounts with their own menus (K12 tutors, job portals) have no tabs or area settings, so
  // the screens that live elsewhere in the standard layout are reached from here.
  if (user && !usesHubLayout(user)) {
    tiles.push({ key: "keyword-replies", label: "Keyword replies", href: "/admin/smart-replies" });
    if (isK12Education) tiles.push({ key: "guardrails", label: "AI Guardrails", href: "/admin/k12/guardrails" });
  }

  return (
    <div className="min-h-screen bg-gray-50 relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
        <GraduationCap className="w-[400px] h-[400px] text-purple-500/[0.04]" strokeWidth={1} />
      </div>
      <HideInHub><header className="bg-white border-b px-4 py-3 flex items-center gap-4 relative z-10">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600">
            <GraduationCap className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold">Training</h1>
        </div>
      </header></HideInHub>

      <div className="p-6 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {tiles.map(t => {
            const look = TILE_LOOK[t.key] ?? TILE_LOOK.instructions;
            const Icon = look.icon;
            return (
              <Card
                key={t.key}
                className={`cursor-pointer hover:shadow-md ${look.hover} transition-all group`}
                onClick={() => setLocation(t.href)}
                data-testid={`card-tile-${t.key}`}
              >
                <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
                  <div className={`p-3 rounded-xl ${look.tile} transition-colors`}>
                    <Icon className={`w-6 h-6 ${look.text}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{t.label}</h3>
                    <p className="text-xs text-muted-foreground mt-1">{look.description}</p>
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
