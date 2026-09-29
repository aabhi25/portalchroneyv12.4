import { useEffect } from "react";
import { useLocation, Redirect } from "wouter";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import CRMIntegrations from "@/pages/CRMIntegrations";
import LeadSquaredSettings from "@/pages/LeadSquaredSettings";
import SalesforceSettings from "@/pages/SalesforceSettings";
import CustomCrmSettings from "@/pages/CustomCrmSettings";
import Shopify from "@/pages/Shopify";
import ErpSettings from "@/pages/ErpSettings";
import { integrationPath, type IntegrationTabId } from "./settingsPaths";

/** "connected" = set up and switched on; "setup" = credentials saved but sync off; "none" = not set up. */
type IntegrationStatus = "connected" | "setup" | "none" | "unknown";

interface IntegrationTab {
  id: IntegrationTabId;
  label: string;
  /** Settings endpoint the tab's own page already reads; used only to derive the badge. */
  statusUrl: string;
  toStatus: (data: any) => IntegrationStatus;
  /** Account-specific display name, when the integration has one (e.g. a named custom CRM). */
  labelFrom?: (data: any) => string | undefined;
  render: () => JSX.Element;
}

const ALL_TABS: IntegrationTab[] = [
  {
    id: "leadsquared",
    label: "LeadSquared",
    statusUrl: "/api/leadsquared/settings",
    toStatus: (d) => {
      const hasCreds = !!(d?.hasCredentials || d?.hasApiKeys || d?.hasUdsKey);
      return d?.enabled && hasCreds ? "connected" : hasCreds ? "setup" : "none";
    },
    render: () => <LeadSquaredSettings embedded />,
  },
  {
    id: "salesforce",
    label: "Salesforce",
    statusUrl: "/api/salesforce/settings",
    toStatus: (d) => (d?.enabled && d?.hasCredentials ? "connected" : d?.hasCredentials ? "setup" : "none"),
    render: () => <SalesforceSettings embedded />,
  },
  {
    id: "custom-crm",
    label: "Custom CRM",
    statusUrl: "/api/custom-crm/settings",
    toStatus: (d) => (d?.enabled ? "connected" : d?.hasCredentials || d?.apiBaseUrl ? "setup" : "none"),
    labelFrom: (d) => (typeof d?.name === "string" && d.name.trim() ? d.name.trim() : undefined),
    render: () => <CustomCrmSettings embedded />,
  },
  {
    id: "shopify",
    label: "Shopify",
    statusUrl: "/api/settings/shopify",
    toStatus: (d) => (d?.hasToken ? "connected" : "none"),
    render: () => <Shopify />,
  },
  {
    id: "erp",
    label: "ERP",
    statusUrl: "/api/erp/config",
    toStatus: (d) =>
      d?.configured && d?.config?.isActive === "true" ? "connected" : d?.configured ? "setup" : "none",
    render: () => <ErpSettings />,
  },
];

const STATUS_BADGE: Record<IntegrationStatus, { label: string; className: string } | null> = {
  connected: { label: "Connected", className: "bg-green-50 text-green-700 border-green-200" },
  setup: { label: "Sync off", className: "bg-amber-50 text-amber-700 border-amber-200" },
  none: { label: "Not set up", className: "bg-gray-50 text-gray-500 border-gray-200" },
  unknown: null,
};

export interface IntegrationsAccess {
  crm: boolean;
  shopify: boolean;
  erp: boolean;
}

export function visibleIntegrationTabs(access: IntegrationsAccess): IntegrationTabId[] {
  return ALL_TABS.filter((t) =>
    t.id === "shopify" ? access.shopify : t.id === "erp" ? access.erp : access.crm,
  ).map((t) => t.id);
}

/**
 * All integrations in one place: each CRM (and Shopify / ERP where enabled) is a tab that renders
 * that integration's existing settings page. The overview tab is the existing CRM chooser.
 */
export default function IntegrationsSettings({ access }: { access: IntegrationsAccess }) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const visibleIds = visibleIntegrationTabs(access);
  const tabs = ALL_TABS.filter((t) => visibleIds.includes(t.id));

  const base = integrationPath();
  const activeId = location.startsWith(base + "/") ? (location.slice(base.length + 1).split("/")[0] as IntegrationTabId) : null;
  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  const statusQueries = useQueries({
    queries: tabs.map((t) => ({
      queryKey: ["settings-hub", "integration-status", t.id],
      queryFn: async () => {
        const res = await fetch(t.statusUrl, { credentials: "include" });
        if (res.status === 404) return { status: "none" as IntegrationStatus };
        if (!res.ok) return { status: "unknown" as IntegrationStatus };
        const data = await res.json().catch(() => null);
        return { status: t.toStatus(data), label: t.labelFrom?.(data) };
      },
      staleTime: 0,
    })),
  });

  // The pages save through their own fetch calls, so refresh the badges whenever the tab changes.
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["settings-hub", "integration-status"] });
  }, [activeId, queryClient]);

  // Unknown or hidden tab in the URL: fall back to the overview (or the only tab there is).
  if (activeId && !activeTab) {
    return <Redirect to={base} replace />;
  }
  if (!activeId && !access.crm && tabs.length > 0) {
    return <Redirect to={integrationPath(tabs[0].id)} replace />;
  }

  const tabButton = (id: IntegrationTabId | null, label: string, status?: IntegrationStatus, loading?: boolean) => {
    const selected = (activeTab?.id ?? null) === id;
    const badge = status ? STATUS_BADGE[status] : null;
    return (
      <button
        key={id ?? "overview"}
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={() => setLocation(integrationPath(id ?? undefined))}
        data-testid={`tab-integration-${id ?? "overview"}`}
        className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
          selected ? "bg-white shadow-sm font-medium text-gray-900" : "text-gray-600 hover:text-gray-900"
        }`}
      >
        {label}
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
        ) : badge ? (
          <span className={`rounded-full border px-1.5 py-0 text-[10px] font-medium ${badge.className}`}>{badge.label}</span>
        ) : null}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Integrations" className="flex gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1 w-fit max-w-full">
        {access.crm && tabButton(null, "Overview")}
        {tabs.map((t, i) => tabButton(t.id, statusQueries[i]?.data?.label ?? t.label, statusQueries[i]?.data?.status, statusQueries[i]?.isLoading))}
      </div>

      {activeTab ? (
        // Keyed so switching tabs always mounts the page fresh (they load their data on mount).
        <div key={activeTab.id}>{activeTab.render()}</div>
      ) : (
        <CRMIntegrations embedded />
      )}
    </div>
  );
}
