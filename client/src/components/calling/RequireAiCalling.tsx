import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { MeResponseDto } from "@shared/dto";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Phone } from "lucide-react";
import { useAiCallingAvailability } from "@/lib/aiCallingApi";
import { CALLING_NAV_ITEMS } from "./callingSections";

export function CallingUnavailable({ detail }: { detail?: string }) {
  const [, setLocation] = useLocation();
  return (
    <div className="p-6">
      <Card className="max-w-lg mx-auto mt-12">
        <CardContent className="pt-6 flex flex-col items-center gap-4 text-center">
          <div className="p-3 rounded-xl bg-sky-50">
            <Phone className="w-6 h-6 text-sky-600" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-base">AI Calling isn't switched on for this account</h3>
            <p className="text-sm text-muted-foreground">{detail || "Ask your administrator to turn on AI Calling."}</p>
          </div>
          <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-calling-back-home">
            Back to home
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** Route guard for the Phone calls pages. Fails closed. */
export function RequireAiCalling({ children }: { children: ReactNode }) {
  const { data: user, isLoading } = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });
  const { enabled, loading } = useAiCallingAvailability(user);
  if (isLoading || loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!enabled) return <CallingUnavailable />;
  return <>{children}</>;
}

/** Page title + the four Phone calls tabs (handy on phones where the sidebar is hidden). */
export function CallingPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const [location, setLocation] = useLocation();
  return (
    <div className="mb-4 space-y-3">
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1" role="tablist" aria-label="Phone calls">
        {CALLING_NAV_ITEMS.map(item => {
          const active = item.matches(location);
          return (
            <button
              key={item.key}
              role="tab"
              aria-selected={active}
              onClick={() => setLocation(item.href)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                active ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              data-testid={`tab-${item.testId}`}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && <p className="text-sm text-gray-600 mt-1">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
