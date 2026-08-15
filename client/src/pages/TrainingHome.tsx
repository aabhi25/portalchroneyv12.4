import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Brain, Route, HelpCircle, Building2, FileText, Globe, GraduationCap, Zap, ShieldCheck } from "lucide-react";
import type { MeResponseDto } from "@shared/dto";

export default function TrainingHome() {
  const [, setLocation] = useLocation();
  const { data: user } = useQuery<MeResponseDto>({ queryKey: ['/api/auth/me'] });
  const isK12Education = user?.businessAccount?.k12EducationEnabled === true;

  return (
    <div className="min-h-screen bg-gray-50 relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
        <GraduationCap className="w-[400px] h-[400px] text-purple-500/[0.04]" strokeWidth={1} />
      </div>
      <header className="bg-white border-b px-4 py-3 flex items-center gap-4 relative z-10">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600">
            <GraduationCap className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold">Training</h1>
        </div>
      </header>

      <div className="p-6 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Card
            className="cursor-pointer hover:shadow-md hover:border-purple-300 transition-all group"
            onClick={() => setLocation("/train-chroney")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-purple-50 group-hover:bg-purple-100 transition-colors">
                <Brain className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Train Chroney</h3>
                <p className="text-xs text-muted-foreground mt-1">AI knowledge base</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-blue-300 transition-all group"
            onClick={() => setLocation("/conversation-journeys")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-blue-50 group-hover:bg-blue-100 transition-colors">
                <Route className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Journeys</h3>
                <p className="text-xs text-muted-foreground mt-1">Guided conversations</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-green-300 transition-all group"
            onClick={() => setLocation("/admin/faqs")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-green-50 group-hover:bg-green-100 transition-colors">
                <HelpCircle className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">FAQs</h3>
                <p className="text-xs text-muted-foreground mt-1">Common questions</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-orange-300 transition-all group"
            onClick={() => setLocation("/admin/about")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-orange-50 group-hover:bg-orange-100 transition-colors">
                <Building2 className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Website Scan</h3>
                <p className="text-xs text-muted-foreground mt-1">Scan your website</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-teal-300 transition-all group"
            onClick={() => setLocation("/admin/scan-docs")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-teal-50 group-hover:bg-teal-100 transition-colors">
                <FileText className="w-6 h-6 text-teal-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Scan Docs</h3>
                <p className="text-xs text-muted-foreground mt-1">Upload documents</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-indigo-300 transition-all group"
            onClick={() => setLocation("/admin/url-training")}
          >
            <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
              <div className="p-3 rounded-xl bg-indigo-50 group-hover:bg-indigo-100 transition-colors">
                <Globe className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Scan URLs</h3>
                <p className="text-xs text-muted-foreground mt-1">Train from web pages</p>
              </div>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:shadow-md hover:border-amber-300 transition-all group"
            onClick={() => setLocation("/admin/smart-replies")}
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
          {isK12Education && (
            <Card
              className="cursor-pointer hover:shadow-md hover:border-cyan-300 transition-all group"
              onClick={() => setLocation("/admin/k12/guardrails")}
              data-testid="card-tile-ai-guardrails"
            >
              <CardContent className="pt-6 flex flex-col items-center gap-3 text-center">
                <div className="p-3 rounded-xl bg-cyan-50 group-hover:bg-cyan-100 transition-colors">
                  <ShieldCheck className="w-6 h-6 text-cyan-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">AI Guardrails</h3>
                  <p className="text-xs text-muted-foreground mt-1">Tutor content controls</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
