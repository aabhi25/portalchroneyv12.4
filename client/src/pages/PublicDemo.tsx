import { useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Building2, Globe, Package, Tag, AlertCircle } from "lucide-react";

interface DemoData {
  id: string;
  title: string;
  description: string;
  appearance: any;
  businessAccount: {
    id: string;
    name: string;
    website: string;
    description: string;
  };
  websiteAnalysis: {
    analyzedContent: any;
  } | null;
  widgetSettings: {
    chatColor: string;
    chatColorEnd: string;
    widgetHeaderText: string;
    buttonStyle: string;
    buttonAnimation: string;
  } | null;
}

export default function PublicDemo() {
  const [, params] = useRoute("/demo/:token");
  const token = params?.token;

  const { data, isLoading, error } = useQuery<DemoData>({
    queryKey: [`/api/demo/by-token/${token}`],
    queryFn: async () => {
      return await apiRequest("GET", `/api/demo/by-token/${token}`);
    },
    enabled: !!token,
  });

  useEffect(() => {
    if (!data) return;

    const businessId = data.businessAccount.id;

    // Check for test_discount query parameter
    const urlParams = new URLSearchParams(window.location.search);
    const testDiscountMessage = urlParams.get('test_discount');
    const discountPct = parseInt(urlParams.get('discount_pct') || '10');
    const expiryMin = parseInt(urlParams.get('expiry_min') || '30');

    const triggerTestDiscount = () => {
      if (testDiscountMessage) {
        // Wait for iframe to be ready, then trigger the discount
        setTimeout(() => {
          const iframe = document.getElementById('hichroney-widget-iframe') as HTMLIFrameElement;
          if (iframe && iframe.contentWindow) {
            // First open the chat by clicking the widget button
            const widgetButton = document.getElementById('hichroney-widget-button') as HTMLElement;
            if (widgetButton) {
              widgetButton.click();
            }
            // Then send the discount message after chat opens
            setTimeout(() => {
              iframe.contentWindow?.postMessage({
                type: 'HICHRONEY_DISCOUNT_TRIGGER',
                triggerType: 'idle_timeout_test',
                message: testDiscountMessage,
                discountPercentage: discountPct,
                expiryMinutes: expiryMin
              }, '*');
            }, 800);
          }
        }, 2000);
      }
    };

    // Use the real embed flow: inject widget-loader.js with data-business-id, exactly as
    // the embed code shown in Widget settings does. widget-loader.js handles page-visit
    // tracking, page-view analytics, scroll depth, section tracking, proactive guidance
    // checks, and then loads widget.js itself.
    //
    // Load it from THIS page's own origin rather than a hardcoded host. widget-loader.js
    // derives its entire API base from its own script URL (and publishes it as
    // window.__chroneyBaseUrl, which widget.js reads first), so the host we load it from
    // decides where conversations, messages and tracking are written. Hardcoding the
    // production host meant a demo opened on any other environment still wrote its chats
    // to production, and they never appeared in that environment's Conversations list.
    // A relative src resolves to the live portal in production and to the local server in
    // development, so demos always talk to the backend that is serving them.
    const script = document.createElement('script');
    script.src = '/widget-loader.js';
    script.setAttribute('data-business-id', businessId);
    script.async = true;

    script.onload = () => {
      triggerTestDiscount();
    };

    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
      const widgetContainer = document.getElementById('hichroney-widget-container');
      const widgetIframe = document.getElementById('hichroney-widget-iframe');
      const widgetButton = document.getElementById('hichroney-widget-button');
      const chatOverlay = document.getElementById('hichroney-chat-overlay');
      if (widgetContainer && document.body.contains(widgetContainer)) {
        document.body.removeChild(widgetContainer);
      }
      if (widgetIframe && document.body.contains(widgetIframe)) {
        document.body.removeChild(widgetIframe);
      }
      if (widgetButton && document.body.contains(widgetButton)) {
        document.body.removeChild(widgetButton);
      }
      if (chatOverlay && document.body.contains(chatOverlay)) {
        document.body.removeChild(chatOverlay);
      }
    };
  }, [data]);

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="text-center w-full max-w-md mx-auto">
          <div className="w-16 h-16 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground text-base">Loading demo...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <Card className="max-w-md w-full mx-auto">
          <CardHeader>
            <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-6 h-6 text-destructive" />
            </div>
            <CardTitle className="text-center">Demo Not Found</CardTitle>
            <CardDescription className="text-center">
              This demo page doesn't exist or has expired
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const content = data.websiteAnalysis?.analyzedContent;

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 md:py-10 max-w-4xl w-full">
        <div className="mb-8 text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">{data.title}</h1>
          {data.description && (
            <p className="text-base md:text-lg text-muted-foreground">{data.description}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              <span>{data.businessAccount.name}</span>
            </div>
            {data.businessAccount.website && (
              <>
                <span className="hidden sm:inline mx-2">•</span>
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  <a
                    href={data.businessAccount.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-purple-600 transition-colors break-all"
                  >
                    {data.businessAccount.website}
                  </a>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:gap-6 w-full">
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <Building2 className="w-5 h-5 flex-shrink-0" />
                <span>About {data.businessAccount.name}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                {content?.businessDescription || data.businessAccount.description || "No description available"}
              </p>
            </CardContent>
          </Card>

          {content?.mainProducts && content.mainProducts.length > 0 && (
            <Card className="w-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <Package className="w-5 h-5 flex-shrink-0" />
                  <span>Products & Services</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 sm:space-y-3">
                  {content.mainProducts.map((product: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 sm:gap-3">
                      <span className="text-purple-600 mt-1 flex-shrink-0 text-sm sm:text-base">•</span>
                      <span className="text-sm sm:text-base">{product}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {content?.keyFeatures && content.keyFeatures.length > 0 && (
            <Card className="w-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <Tag className="w-5 h-5 flex-shrink-0" />
                  <span>Key Features</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 sm:space-y-3">
                  {content.keyFeatures.map((feature: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 sm:gap-3">
                      <span className="text-purple-600 mt-1 flex-shrink-0 text-sm sm:text-base">✓</span>
                      <span className="text-sm sm:text-base">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card className="w-full bg-gradient-to-br from-purple-50 to-blue-50 border-purple-200">
            <CardHeader>
              <CardTitle className="text-lg sm:text-xl">Try the AI Assistant</CardTitle>
              <CardDescription className="text-sm sm:text-base">
                Click the chat button in the bottom right to start a conversation with our AI assistant.
                Ask questions about our products, services, or anything else!
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <footer className="mt-8 sm:mt-12 text-center text-xs sm:text-sm text-muted-foreground pb-6 sm:pb-8 w-full">
          <Separator className="mb-4" />
          <p>Powered by AI Chroney - Intelligent Business Chat Platform</p>
        </footer>
      </div>
    </div>
  );
}
