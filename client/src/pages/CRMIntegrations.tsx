import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";
import MoreFeaturesNavTabs from "@/components/MoreFeaturesNavTabs";

interface CrmIntegration {
  id: string;
  name: string;
  description: string;
  features: string[];
  available: boolean;
  route: string;
}

export default function CRMIntegrations() {
  const [, setLocation] = useLocation();
  const [integrations, setIntegrations] = useState<CrmIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const cameFromWhatsApp =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("from") === "whatsapp";

  useEffect(() => {
    fetch("/api/crm/available-integrations", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load integrations");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setIntegrations(data);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <MoreFeaturesNavTabs />
      <div className="container mx-auto p-6 max-w-6xl">
        {cameFromWhatsApp && (
          <Button
            variant="ghost"
            size="sm"
            className="mb-4 -ml-2"
            onClick={() => setLocation("/admin/whatsapp")}
            data-testid="button-back-to-whatsapp-hub"
            aria-label="Back to WhatsApp"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to WhatsApp
          </Button>
        )}
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">CRM Integrations</h1>
          <p className="text-muted-foreground">
            Connect your favorite CRM to automatically sync leads captured by Chroney
          </p>
        </div>

        {!loading && loadError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            We couldn't load your CRM integrations. Please refresh the page or try again later.
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="relative overflow-hidden">
                  <CardHeader>
                    <Skeleton className="h-6 w-32 mb-2" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-4 w-20 mb-3" />
                    <div className="space-y-2">
                      {Array.from({ length: 4 }).map((_, j) => (
                        <Skeleton key={j} className="h-3 w-full" />
                      ))}
                    </div>
                    <Skeleton className="h-10 w-full mt-4" />
                  </CardContent>
                </Card>
              ))
            : integrations.map((crm) => (
                <Card key={crm.id} className="relative overflow-hidden">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-xl">{crm.name}</CardTitle>
                        <CardDescription className="mt-2">
                          {crm.description}
                        </CardDescription>
                      </div>
                      {crm.available && (
                        <div className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 dark:bg-green-950 dark:text-green-400 px-2 py-1 rounded-full">
                          <CheckCircle2 className="h-3 w-3" />
                          Available
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {crm.features.length > 0 && (
                        <div>
                          <p className="text-sm font-medium mb-2">Features:</p>
                          <ul className="space-y-1.5">
                            {crm.features.map((feature, index) => (
                              <li key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                                {feature}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <Button
                        onClick={() => setLocation(crm.route)}
                        disabled={!crm.available}
                        className={crm.available ? "w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600" : "w-full"}
                        variant={crm.available ? "default" : "outline"}
                      >
                        {crm.available ? (
                          <>
                            Configure Integration
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        ) : (
                          "Coming Soon"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
        </div>
      </div>
    </div>
  );
}
