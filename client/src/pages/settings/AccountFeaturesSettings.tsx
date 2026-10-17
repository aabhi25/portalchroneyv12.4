import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { LucideIcon } from "lucide-react";
import { Calendar, Headphones, Loader2, Megaphone, Mic, PackageOpen, ShoppingBag, Video } from "lucide-react";
import type { BusinessAccountDto, ProductTier } from "@shared/dto";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { LiveAvatarSettingsDialog } from "@/components/LiveAvatarSettingsDialog";
import { hubArea, type HubAreaId } from "@/navigation/hubAreas";
import { callingApi, callingKeys, errorStatus, type SuperAdminCallingState } from "@/lib/aiCallingApi";

/**
 * Settings › Features on this account (super admins viewing as a business only).
 *
 * The same switches as Super Admin › Business accounts ("Product features" and "Manage modules"),
 * saved through the same endpoints, so both places always show the same thing:
 *  - add-ons and channel switches → PATCH /api/business-accounts/:id/features
 *  - anything that changes the product tier (Vista) → PUT /api/business-accounts/:id
 *  - Phone calls → PUT /api/super-admin/ai-calling/:id
 *  - Live video avatar → the same set-up dialog as the Business accounts list
 */

type FlagField =
  | "chroneyEnabled" | "whatsappEnabled" | "instagramEnabled" | "facebookEnabled"
  | "whatsappMarketingEnabled" | "voiceModeEnabled" | "supportTicketsEnabled"
  | "appointmentsEnabled" | "demoOrdersEnabled" | "shopifyEnabled";

const accountKey = (id: string) => ["/api/business-accounts", id];
const avatarKey = (id: string) => ["/api/super-admin/avatar/accounts", id];

const isJewelryTier = (tier: ProductTier) => tier === "jewelry_showcase" || tier === "jewelry_showcase_chroney";

/** Same rule as the Business accounts "Product features" dialog. */
function deriveProductTier(chroney: boolean, jewelry: boolean): ProductTier {
  if (chroney && jewelry) return "jewelry_showcase_chroney";
  if (jewelry) return "jewelry_showcase";
  return "chroney";
}

/** Vista shows in the sidebar only with a jewellery tier and, next to Website chat, the showcase switch on. */
const vistaOn = (ba: BusinessAccountDto) =>
  isJewelryTier(ba.productTier) && (ba.productTier === "jewelry_showcase" || ba.jewelryShowcaseEnabled);

function Row({ icon: Icon, tint, label, description, hint, children }: {
  icon: LucideIcon; tint: string; label: string; description: string; hint?: string | null; children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 border-t border-black/[0.06] px-4 py-3 first:border-t-0">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${tint}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-medium text-gray-900">{label}</p>
        <p className="text-[12.5px] text-gray-500">{description}</p>
        {hint && <p className="mt-0.5 text-[12px] text-amber-700">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="px-1.5 pb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-gray-400">{title}</h3>
      <ul className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">{children}</ul>
    </section>
  );
}

export default function AccountFeaturesSettings({ businessAccountId }: { businessAccountId: string }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [busy, setBusy] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);

  const account = useQuery<BusinessAccountDto>({ queryKey: accountKey(businessAccountId), staleTime: 0 });
  const calling = useQuery<SuperAdminCallingState>({
    queryKey: callingKeys.superAdmin(businessAccountId),
    queryFn: () => callingApi.superAdminGet(businessAccountId),
    staleTime: 0,
    retry: false,
  });
  const avatar = useQuery<{ settings: { enabled: boolean } }>({ queryKey: avatarKey(businessAccountId), retry: false });

  const refreshEverywhere = () => {
    // The portal's own menus, and the Business accounts list.
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
  };

  const save = useMutation({
    mutationFn: async ({ run }: { key: string; label: string; on: boolean; run: () => Promise<BusinessAccountDto> }) => run(),
    onMutate: ({ key }) => setBusy(key),
    onSuccess: (updated, { label, on }) => {
      queryClient.setQueryData(accountKey(businessAccountId), updated);
      refreshEverywhere();
      toast({ title: `${label} ${on ? "switched on" : "switched off"}`, description: "This account's menus update straight away." });
    },
    onError: (e: Error, { label }) => {
      queryClient.invalidateQueries({ queryKey: accountKey(businessAccountId) });
      toast({ title: `Couldn't change ${label}`, description: e.message, variant: "destructive" });
    },
    onSettled: () => setBusy(null),
  });

  const saveCalling = useMutation({
    mutationFn: (enabled: boolean) =>
      callingApi.superAdminPut(businessAccountId, { enabled, monthlyMinuteCap: calling.data?.monthlyMinuteCap ?? null }),
    onMutate: () => setBusy("calls"),
    onSuccess: (data, enabled) => {
      queryClient.setQueryData(callingKeys.superAdmin(businessAccountId), { ...calling.data, ...data });
      queryClient.invalidateQueries({ queryKey: accountKey(businessAccountId) });
      queryClient.invalidateQueries({ queryKey: callingKeys.settings });
      refreshEverywhere();
      toast({ title: `Phone calls ${enabled ? "switched on" : "switched off"}`, description: "This account's menus update straight away." });
    },
    onError: (e: Error) => toast({ title: "Couldn't change Phone calls", description: e.message, variant: "destructive" }),
    onSettled: () => setBusy(null),
  });

  if (account.isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;
  }
  const ba = account.data;
  if (!ba) {
    return (
      <div className="rounded-2xl border border-black/[0.07] bg-white p-6 text-sm text-gray-600">
        This account's features couldn't be loaded. {account.error instanceof Error ? account.error.message : ""}
      </div>
    );
  }

  const patchFeatures = (body: Partial<Record<FlagField | "jewelryShowcaseEnabled", boolean>>) =>
    apiRequest<BusinessAccountDto>("PATCH", `/api/business-accounts/${ba.id}/features`, body);

  /** Same request the "Product features" dialog sends. */
  const saveTier = (chroney: boolean, jewelry: boolean) =>
    apiRequest<BusinessAccountDto>("PUT", `/api/business-accounts/${ba.id}`, {
      name: ba.name,
      website: ba.website || "",
      productTier: deriveProductTier(chroney, jewelry),
      chroneyEnabled: chroney,
      whatsappEnabled: ba.whatsappEnabled,
      instagramEnabled: ba.instagramEnabled,
      facebookEnabled: ba.facebookEnabled,
      k12EducationEnabled: ba.k12EducationEnabled,
      jobPortalEnabled: ba.jobPortalEnabled,
    });

  const setFlag = (field: FlagField, label: string, on: boolean) =>
    save.mutate({
      key: field, label, on,
      // With Vista on, Website chat is part of the product tier, so it is saved the way the dialog saves it.
      run: () => field === "chroneyEnabled" && isJewelryTier(ba.productTier)
        ? saveTier(on, true)
        : patchFeatures({ [field]: on }),
    });

  const setVista = (on: boolean) =>
    save.mutate({
      key: "vista", label: "Vista", on,
      run: async () => {
        const updated = await saveTier(ba.chroneyEnabled, on);
        // Next to Website chat, Vista also needs its showcase switch (Manage modules › Jewelry Showcase).
        if (on && ba.chroneyEnabled && !updated.jewelryShowcaseEnabled) return patchFeatures({ jewelryShowcaseEnabled: true });
        return updated;
      },
    });

  const pending = save.isPending || saveCalling.isPending;
  const spinner = (key: string) => busy === key ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : null;

  const flagSwitch = (field: FlagField, label: string) => (
    <>
      {spinner(field)}
      <Switch
        checked={ba[field] === true}
        disabled={pending}
        onCheckedChange={(v) => setFlag(field, label, v)}
        aria-label={label}
        data-testid={`switch-feature-${field}`}
      />
    </>
  );

  const area = (id: HubAreaId) => ({ icon: hubArea(id).icon, tint: hubArea(id).tint });

  const callingUnavailable = calling.isError && (errorStatus(calling.error) === 404 || errorStatus(calling.error) === 501);
  const callingOn = calling.data?.enabled ?? ba.aiCallingEnabled;
  const hasProducts = ba.chroneyEnabled || ba.whatsappEnabled || isJewelryTier(ba.productTier);

  return (
    <div className="max-w-[760px] space-y-6">
      <Group title="AI agents">
        <Row {...area("website")} label="Website chat" description="The chat widget on the business's website">
          {flagSwitch("chroneyEnabled", "Website chat")}
        </Row>
        <Row {...area("whatsapp")} label="WhatsApp" description="AI replies on the business's WhatsApp number">
          {flagSwitch("whatsappEnabled", "WhatsApp")}
        </Row>
        <Row {...area("instagram")} label="Instagram" description="AI replies to Instagram messages and comments">
          {flagSwitch("instagramEnabled", "Instagram")}
        </Row>
        <Row {...area("facebook")} label="Facebook" description="AI replies to Facebook messages and comments">
          {flagSwitch("facebookEnabled", "Facebook")}
        </Row>
        <Row
          {...area("calls")}
          label="Phone calls"
          description="The AI phones new leads and answers the business's number"
          hint={callingUnavailable ? "The AI Calling server update isn't installed yet." : null}
        >
          {!callingUnavailable && (
            <>
              {callingOn && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[12.5px] text-purple-700" onClick={() => setLocation("/admin/calling/settings")} data-testid="link-calling-limits">
                  Limits
                </Button>
              )}
              {spinner("calls")}
              <Switch
                checked={callingOn}
                disabled={pending || calling.isLoading}
                onCheckedChange={(v) => saveCalling.mutate(v)}
                aria-label="Phone calls"
                data-testid="switch-feature-aiCalling"
              />
            </>
          )}
        </Row>
        <Row {...area("vista")} label="Vista" description="Visual search for jewellery: customers upload a photo and find matching designs">
          {spinner("vista")}
          <Switch checked={vistaOn(ba)} disabled={pending} onCheckedChange={setVista} aria-label="Vista" data-testid="switch-feature-vista" />
        </Row>
      </Group>

      <Group title="Add-ons">
        <Row
          icon={Megaphone} tint="bg-emerald-600" label="WhatsApp campaigns"
          description="Template campaigns to imported contacts, with AI handling the replies"
          hint={!ba.whatsappEnabled ? "Needs WhatsApp switched on to show up." : null}
        >
          {flagSwitch("whatsappMarketingEnabled", "WhatsApp campaigns")}
        </Row>
        <Row
          icon={Mic} tint="bg-indigo-500" label="Voice mode"
          description="Visitors can talk to the website chat out loud"
          hint={!ba.chroneyEnabled ? "Needs Website chat switched on to show up." : null}
        >
          {flagSwitch("voiceModeEnabled", "Voice mode")}
        </Row>
        <Row
          icon={Video} tint="bg-fuchsia-600" label="Live video avatar"
          description="A talking video face on top of voice mode, with its own provider, key and minute limits"
          hint={!ba.voiceModeEnabled ? "Needs Voice mode switched on to show up." : null}
        >
          <span className="text-[12.5px] text-gray-500" data-testid="text-avatar-status">
            {avatar.isLoading ? "…" : avatar.data?.settings.enabled ? "On" : "Off"}
          </span>
          <Button variant="outline" size="sm" className="h-7" onClick={() => setAvatarOpen(true)} data-testid="button-feature-avatar">
            Set up
          </Button>
        </Row>
        <Row icon={Headphones} tint="bg-orange-500" label="Support tickets" description="A queue for the questions the AI hands over to people">
          {flagSwitch("supportTicketsEnabled", "Support tickets")}
        </Row>
        <Row
          icon={Calendar} tint="bg-purple-600" label="Appointments"
          description="Visitors book appointments in the chat"
          hint={!ba.chroneyEnabled ? "Needs Website chat switched on to show up." : null}
        >
          {flagSwitch("appointmentsEnabled", "Appointments")}
        </Row>
        <Row icon={PackageOpen} tint="bg-rose-500" label="Demo orders" description="Sample orders for showing order tracking and returns in demos">
          {flagSwitch("demoOrdersEnabled", "Demo orders")}
        </Row>
        <Row
          icon={ShoppingBag} tint="bg-green-600" label="Shopify"
          description="Bring products in from a Shopify store"
          hint={!hasProducts ? "Needs Website chat, WhatsApp or Vista switched on to show up." : null}
        >
          {flagSwitch("shopifyEnabled", "Shopify")}
        </Row>
      </Group>

      <p className="px-1.5 text-[12.5px] text-gray-500">
        These are the same switches as Super Admin › Business accounts. Changes apply straight away for everyone on this account.
      </p>

      {avatarOpen && (
        <LiveAvatarSettingsDialog
          open={avatarOpen}
          onOpenChange={setAvatarOpen}
          businessAccountId={ba.id}
          businessName={ba.name}
        />
      )}
    </div>
  );
}
