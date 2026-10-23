import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Circle, Copy, ExternalLink, Globe, Loader2, Megaphone, MessageCircle, Phone, RefreshCw, ShoppingBag } from "lucide-react";
import type { MeResponseDto } from "@shared/dto";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { AiCallingMinuteCap } from "@/components/calling/SuperAdminAiCallingCard";
import { getPublicWidgetOrigin } from "@/lib/deploymentUrls";
import { SetupPanel } from "./SetupPanel";
import { featureStatusKey, type FeatureStatus } from "./VoiceSetupPanel";

export type SetupFeature = "phoneCalls" | "whatsapp" | "whatsappCampaigns" | "website" | "shopify";

export interface ChecklistStatus extends FeatureStatus {
  summary?: string;
  checks?: { label: string; done: boolean; detail?: string }[];
  lastMessage?: string | null;
  storeUrl?: string | null;
  products?: number;
}

/**
 * Go to one of this account's own settings pages. Already viewing the account: just go there.
 * From the Super Admin account page: enter the account first (as "Open portal" does), then go.
 */
function useOpenAccountPage(accountId: string) {
  const { toast } = useToast();
  const me = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });
  const [busy, setBusy] = useState(false);
  return {
    busy,
    open: async (path: string) => {
      if (me.data?.activeBusinessAccountId === accountId) {
        window.location.href = path;
        return;
      }
      setBusy(true);
      try {
        await apiRequest("POST", `/api/super-admin/impersonate/${accountId}`);
        sessionStorage.removeItem("lastPath");
        queryClient.clear(); // everything cached belongs to the previous view
        window.location.href = path;
      } catch (e: any) {
        setBusy(false);
        toast({ title: "Couldn't open the account", description: e?.message, variant: "destructive" });
      }
    },
  };
}

function Checklist({ checks }: { checks?: ChecklistStatus["checks"] }) {
  if (!checks?.length) return null;
  return (
    <ul className="divide-y rounded-xl border" data-testid="setup-checklist">
      {checks.map(c => (
        <li key={c.label} className="flex items-start gap-2.5 px-3 py-2.5 text-sm">
          {c.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />}
          <div className="min-w-0">
            <p className={c.done ? "text-gray-800" : "text-gray-600"}>{c.label}</p>
            {c.detail && <p className="text-xs text-muted-foreground">{c.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StateBanner({ status, offText }: { status?: ChecklistStatus; offText: string }) {
  if (!status) return null;
  if (status.state === "ready") return <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">Ready{status.summary ? ` · ${status.summary}` : ""}</p>;
  if (status.state === "off") return <p className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-600">{offText}</p>;
  return <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{status.problem}</p>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium text-gray-900">{title}</h4>
      {children}
    </section>
  );
}

const META: Record<SetupFeature, { icon: LucideIcon; title: string; description: string; page: string; pageLabel: string; offText: string }> = {
  phoneCalls: {
    icon: Phone, title: "Phone calls", page: "/admin/calling/settings", pageLabel: "Open Phone calls settings",
    description: "The AI phones new leads and answers the business's number. The phone provider, number and what the AI says are set in Phone calls › Settings.",
    offText: "Phone calls are switched off for this account.",
  },
  whatsapp: {
    icon: MessageCircle, title: "WhatsApp", page: "/admin/whatsapp/settings/connection", pageLabel: "Open Number & connection",
    description: "AI replies on the business's WhatsApp number, through MSG91.",
    offText: "WhatsApp is switched off for this account.",
  },
  whatsappCampaigns: {
    icon: Megaphone, title: "WhatsApp campaigns", page: "/admin/whatsapp-campaigns", pageLabel: "Open Campaigns",
    description: "Template campaigns to imported contacts; replies go to the AI. Needs WhatsApp connected and approved templates.",
    offText: "WhatsApp campaigns are switched off for this account.",
  },
  website: {
    icon: Globe, title: "Website chat", page: "/admin/website/settings/install", pageLabel: "Open install page",
    description: "The chat widget on the business's website. Paste the code below on every page, just before </body>.",
    offText: "Website chat is switched off for this account.",
  },
  shopify: {
    icon: ShoppingBag, title: "Shopify", page: "/admin/shopify", pageLabel: "Open Shopify connection",
    description: "Products come in from the business's Shopify store. Connecting the store is done from the account (Shopify asks to approve the app).",
    offText: "Shopify is switched off for this account.",
  },
};

/** The set-up panel for Phone calls, WhatsApp, WhatsApp campaigns, Website chat or Shopify. */
export function FeatureSetupPanel({ feature, onOpenChange, businessAccountId, businessName, status }: {
  feature: SetupFeature | null;
  onOpenChange: (open: boolean) => void;
  businessAccountId: string;
  businessName: string;
  status?: ChecklistStatus;
}) {
  const { toast } = useToast();
  const openPage = useOpenAccountPage(businessAccountId);
  const meta = feature ? META[feature] : null;

  const sync = useMutation({
    mutationFn: () => apiRequest<{ success: boolean; message?: string; error?: string }>("POST", `/api/super-admin/accounts/${businessAccountId}/shopify/sync`),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: featureStatusKey(businessAccountId) });
      toast({ title: "Shopify synced", description: r?.message });
    },
    onError: (e: Error) => toast({ title: "Shopify sync failed", description: e.message, variant: "destructive" }),
  });

  if (!feature || !meta) return null;
  const embedCode = `<!-- AI Chroney Widget -->\n<script src="${getPublicWidgetOrigin()}/widget-loader.js" data-business-id="${businessAccountId}"></script>`;

  return (
    <SetupPanel
      open={!!feature}
      onOpenChange={onOpenChange}
      icon={meta.icon}
      title={<>{meta.title} · {businessName}</>}
      description={meta.description}
      testId={`panel-setup-${feature}`}
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        <Button onClick={() => openPage.open(meta.page)} disabled={openPage.busy} data-testid="button-setup-open-page">
          {openPage.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}{meta.pageLabel}
        </Button>
      </>}
    >
      <div className="space-y-5">
        <StateBanner status={status} offText={meta.offText} />

        {feature === "website" && (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-gray-900">Embed code</h4>
              <Button
                size="sm" variant="outline" className="h-7"
                onClick={() => { navigator.clipboard?.writeText(embedCode).then(() => toast({ title: "Embed code copied" })).catch(() => undefined); }}
                data-testid="button-copy-embed"
              >
                <Copy className="mr-1 h-3.5 w-3.5" /> Copy
              </Button>
            </div>
            <pre className="whitespace-pre-wrap break-all rounded-xl bg-gray-900 p-3 text-xs text-gray-100" data-testid="text-embed-code">{embedCode}</pre>
            <p className="text-xs text-muted-foreground">To open the chat from the site's own button, add <code>data-chroney-open-chat</code> to that button (more on the install page).</p>
          </section>
        )}

        <Section title={feature === "website" ? "Is it live?" : "Checklist"}>
          <Checklist checks={status?.checks} />
          {feature === "whatsapp" && status?.state !== "off" && (
            <p className="text-xs text-muted-foreground">{status?.lastMessage ? `Last WhatsApp message ${status.lastMessage}.` : "No WhatsApp messages received yet."}</p>
          )}
        </Section>

        {feature === "phoneCalls" && status?.state !== "off" && (
          <Section title="Minutes">
            <AiCallingMinuteCap businessAccountId={businessAccountId} />
          </Section>
        )}

        {feature === "shopify" && status?.state !== "off" && (
          <Section title="Products">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
              <span>{status?.products ?? 0} products from {status?.storeUrl || "Shopify"}</span>
              <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending || !status?.storeUrl} data-testid="button-shopify-sync">
                {sync.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />} Sync now
              </Button>
            </div>
          </Section>
        )}

        {feature !== "website" && (
          <p className="text-xs text-muted-foreground">
            Anything not ticked is set on the account's own page: "{meta.pageLabel}" opens it as this account.
          </p>
        )}
      </div>
    </SetupPanel>
  );
}
