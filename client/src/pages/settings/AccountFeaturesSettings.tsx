import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { Briefcase, Calendar, Camera, CheckCircle2, GraduationCap, Headphones, LayoutGrid, Link2, Loader2, Megaphone, Mic, PackageOpen, School, ShoppingBag, TriangleAlert, Video } from "lucide-react";
import type { BusinessAccountDto, ProductTier, SystemMode } from "@shared/dto";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AiCallingMinuteCap } from "@/components/calling/SuperAdminAiCallingCard";
import { photoSearchSummary, usePhotoSearchStatus } from "@/components/photoSearch/GeminiKeyEditor";
import { LiveAvatarSettingsDialog } from "@/components/LiveAvatarSettingsDialog";
import { TutorSettingsDialog, tutorKey, type TutorAdminView } from "@/components/TutorSettingsDialog";
import { VoiceSetupPanel, featureStatusKey, useVoiceStatusText, type FeatureStatus } from "@/components/hub/VoiceSetupPanel";
import { FeatureSetupPanel, type ChecklistStatus, type SetupFeature } from "@/components/hub/FeatureSetupPanels";
import { hubArea, type HubAreaId } from "@/navigation/hubAreas";
import { callingApi, callingKeys, errorStatus, type SuperAdminCallingState } from "@/lib/aiCallingApi";

/**
 * Everything a business account gets, in one list. Super admins only; shown in two places with the
 * same switches so they never disagree:
 *  - Settings › Features on this account (while viewing as the business)
 *  - Super Admin › Business accounts › Features (a dialog on the list)
 *
 * Saved through:
 *  - system mode, add-ons and channel switches → PATCH /api/business-accounts/:id/features
 *  - anything that changes the product tier (Vista) → PUT /api/business-accounts/:id
 *  - Phone calls → PUT /api/super-admin/ai-calling/:id
 *  - Live video avatar → the same set-up dialog as the Business accounts list
 */

type FlagField =
  | "chroneyEnabled" | "whatsappEnabled" | "instagramEnabled" | "facebookEnabled"
  | "whatsappMarketingEnabled" | "voiceModeEnabled" | "supportTicketsEnabled"
  | "appointmentsEnabled" | "demoOrdersEnabled" | "shopifyEnabled" | "visualSearchEnabled"
  | "k12EducationEnabled" | "jobPortalEnabled";

const accountKey = (id: string) => ["/api/business-accounts", id];
const avatarKey = (id: string) => ["/api/super-admin/avatar/accounts", id];

const isJewelryTier = (tier: ProductTier) => tier === "jewelry_showcase" || tier === "jewelry_showcase_chroney";

/** Which product tier the Website chat + Vista switches add up to. */
function deriveProductTier(chroney: boolean, jewelry: boolean): ProductTier {
  if (chroney && jewelry) return "jewelry_showcase_chroney";
  if (jewelry) return "jewelry_showcase";
  return "chroney";
}

/** Vista shows in the sidebar only with a jewellery tier and, next to Website chat, the showcase switch on. */
const vistaOn = (ba: BusinessAccountDto) =>
  isJewelryTier(ba.productTier) && (ba.productTier === "jewelry_showcase" || ba.jewelryShowcaseEnabled);

function Row({ icon: Icon, tint, label, description, hint, below, children }: {
  icon: LucideIcon; tint: string; label: string; description: string; hint?: string | null; below?: ReactNode; children: ReactNode;
}) {
  return (
    <li className="border-t border-black/[0.06] px-4 py-3 first:border-t-0">
      <div className="flex items-center gap-3">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${tint}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-medium text-gray-900">{label}</p>
          <p className="text-[12.5px] text-gray-500">{description}</p>
          {hint && <p className="mt-0.5 text-[12px] text-amber-700">{hint}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
      {below && <div className="mt-3 pl-11">{below}</div>}
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
  const [busy, setBusy] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [setupFeature, setSetupFeature] = useState<SetupFeature | null>(null);

  const account = useQuery<BusinessAccountDto>({ queryKey: accountKey(businessAccountId), staleTime: 0 });
  const calling = useQuery<SuperAdminCallingState>({
    queryKey: callingKeys.superAdmin(businessAccountId),
    queryFn: () => callingApi.superAdminGet(businessAccountId),
    staleTime: 0,
    retry: false,
  });
  const avatar = useQuery<{ settings: { enabled: boolean } }>({ queryKey: avatarKey(businessAccountId), retry: false });
  const tutor = useQuery<TutorAdminView>({ queryKey: tutorKey(businessAccountId), retry: false });
  const photoSearch = usePhotoSearchStatus(businessAccountId);
  // What each feature still needs (status lines and "Needs attention").
  const featureStatus = useQuery<Record<string, ChecklistStatus>>({ queryKey: featureStatusKey(businessAccountId), retry: false, staleTime: 0 });
  const voiceText = useVoiceStatusText(featureStatus.data?.voiceMode, businessAccountId);

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
      queryClient.invalidateQueries({ queryKey: tutorKey(businessAccountId) }); // K12 decides whether the AI tutor applies
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", businessAccountId, "photo-search"] });
      queryClient.invalidateQueries({ queryKey: featureStatusKey(businessAccountId) });
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

  const patchFeatures = (body: Partial<Record<FlagField | "jewelryShowcaseEnabled", boolean>> & { systemMode?: SystemMode }) =>
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

  const setSystemMode = (mode: SystemMode) =>
    save.mutate({
      key: "systemMode", label: mode === "essential" ? "Essential menu" : "Full menu", on: true,
      run: () => patchFeatures({ systemMode: mode }),
    });

  const pending = save.isPending || saveCalling.isPending;
  // Where photo search stands (engine, key, catalog indexed), under the rows that use it
  const photoStatus = photoSearch.data ? photoSearchSummary(photoSearch.data) : null;
  const photoStatusLine = photoStatus
    ? <p className={`text-[12px] ${photoStatus.warn ? "text-amber-700" : "text-gray-500"}`} data-testid="text-feature-photo-search">{photoStatus.text}</p>
    : null;
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

  /** "Ready · …" in green, or what is missing in amber, under a feature's row. */
  const statusLine = (status: FeatureStatus | undefined, text: string | null, testId: string) => {
    if (!status || status.state === "off" || !text) return null;
    const ready = status.state === "ready";
    return (
      <p className={`flex items-center gap-1.5 text-[12px] ${ready ? "text-green-700" : "text-amber-700"}`} data-testid={testId}>
        {ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
        {ready ? `Ready · ${text}` : text}
      </p>
    );
  };
  // Visual product search / Vista: from the photo-search status the page already reads.
  const visualSearchStatus: ChecklistStatus | undefined = !(ba.visualSearchEnabled || vistaOn(ba))
    ? { state: "off" }
    : photoSearch.data
      ? {
          state: photoStatus?.warn ? "needs_setup" : "ready",
          problem: photoStatus?.warn ? "No Gemini key yet, so photo search finds nothing" : undefined,
          summary: photoStatus?.text,
          checks: [
            { label: "A Gemini key (the platform's or this account's)", done: photoSearch.data.engine !== "none" },
            { label: "Product photos indexed", done: photoSearch.data.products.withPhoto > 0 && photoSearch.data.products.indexed >= photoSearch.data.products.withPhoto - photoSearch.data.products.failed, detail: `${photoSearch.data.products.indexed} of ${photoSearch.data.products.withPhoto} indexed` },
          ],
        }
      : undefined;
  const statusOf = (feature: SetupFeature): ChecklistStatus | undefined =>
    feature === "visualSearch" ? visualSearchStatus : featureStatus.data?.[feature];

  /** Row status for the checklist features: the summary when ready, else what is missing. */
  const checklistLine = (feature: SetupFeature) => {
    const st = statusOf(feature);
    return statusLine(st, st ? (st.state === "ready" ? st.summary || "set up" : st.problem || "Needs setting up") : null, `text-status-${feature}`);
  };
  const setUpButton = (feature: SetupFeature) => (
    <Button variant="outline" size="sm" className="h-7" onClick={() => setSetupFeature(feature)} data-testid={`button-setup-${feature}`}>
      Set up
    </Button>
  );
  const CHECKLIST_LABELS: Record<SetupFeature, string> = {
    website: "Website chat", whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook", phoneCalls: "Phone calls",
    whatsappCampaigns: "WhatsApp campaigns", visualSearch: "Visual product search", appointments: "Appointments",
    supportTickets: "Support tickets", demoOrders: "Demo orders", shopify: "Shopify", crm: "CRM",
  };
  const needsAttention = [
    featureStatus.data?.voiceMode?.state === "needs_setup" ? { label: "Voice mode", open: () => setVoiceOpen(true) } : null,
    ...(Object.keys(CHECKLIST_LABELS) as SetupFeature[]).map(f =>
      statusOf(f)?.state === "needs_setup" ? { label: CHECKLIST_LABELS[f], open: () => setSetupFeature(f) } : null),
  ].filter((x): x is { label: string; open: () => void } => !!x);

  const callingUnavailable = calling.isError && (errorStatus(calling.error) === 404 || errorStatus(calling.error) === 501);
  const callingOn = calling.data?.enabled ?? ba.aiCallingEnabled;
  const hasProducts = ba.chroneyEnabled || ba.whatsappEnabled || isJewelryTier(ba.productTier);
  const nothingOn = !ba.chroneyEnabled && !ba.whatsappEnabled && !ba.instagramEnabled && !ba.facebookEnabled
    && !callingOn && !vistaOn(ba) && !ba.k12EducationEnabled && !ba.jobPortalEnabled;

  return (
    <div className="max-w-[760px] space-y-6">
      <Group title="Menu">
        <Row
          icon={LayoutGrid} tint="bg-slate-500" label="System mode"
          description={(ba.systemMode || "full") === "essential"
            ? "Essential: only the core pages (Home, Leads, Conversations, Products, Widget, Settings)"
            : "Full: every page, including Training, Smart discounts and Gaps"}
        >
          {spinner("systemMode")}
          <Select value={ba.systemMode || "full"} onValueChange={(v) => setSystemMode(v as SystemMode)} disabled={pending}>
            <SelectTrigger className="h-8 w-[120px]" aria-label="System mode" data-testid="select-system-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Full</SelectItem>
              <SelectItem value="essential">Essential</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Group>

      {needsAttention.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800" data-testid="text-needs-attention">
          <TriangleAlert className="h-4 w-4" />
          <span>{needsAttention.length === 1 ? "1 feature needs attention:" : `${needsAttention.length} features need attention:`}</span>
          {needsAttention.map(n => (
            <button key={n.label} type="button" onClick={n.open} className="font-medium underline underline-offset-2">{n.label}</button>
          ))}
        </div>
      )}

      {nothingOn && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800" data-testid="text-nothing-on">
          Nothing is switched on yet, so this account's menu is almost empty. Switch on at least one agent below.
        </p>
      )}

      <Group title="AI agents">
        <Row {...area("website")} label="Website chat" description="The chat widget on the business's website" below={checklistLine("website")}>
          {setUpButton("website")}
          {flagSwitch("chroneyEnabled", "Website chat")}
        </Row>
        <Row {...area("whatsapp")} label="WhatsApp" description="AI replies on the business's WhatsApp number" below={checklistLine("whatsapp")}>
          {setUpButton("whatsapp")}
          {flagSwitch("whatsappEnabled", "WhatsApp")}
        </Row>
        <Row {...area("instagram")} label="Instagram" description="AI replies to Instagram messages and comments" below={checklistLine("instagram")}>
          {setUpButton("instagram")}
          {flagSwitch("instagramEnabled", "Instagram")}
        </Row>
        <Row {...area("facebook")} label="Facebook" description="AI replies to Facebook messages and comments" below={checklistLine("facebook")}>
          {setUpButton("facebook")}
          {flagSwitch("facebookEnabled", "Facebook")}
        </Row>
        <Row
          {...area("calls")}
          label="Phone calls"
          description="The AI phones new leads and answers the business's number"
          hint={callingUnavailable ? "The AI Calling server update isn't installed yet." : null}
          below={!callingUnavailable && callingOn ? <div className="space-y-2">{checklistLine("phoneCalls")}<AiCallingMinuteCap businessAccountId={ba.id} /></div> : null}
        >
          {!callingUnavailable && (
            <>
              {setUpButton("phoneCalls")}
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
        <Row {...area("vista")} label="Vista" description="Visual search for jewellery: customers upload a photo and find matching designs" below={vistaOn(ba) ? photoStatusLine : null}>
          {setUpButton("visualSearch")}
          {spinner("vista")}
          <Switch checked={vistaOn(ba)} disabled={pending} onCheckedChange={setVista} aria-label="Vista" data-testid="switch-feature-vista" />
        </Row>
      </Group>

      <Group title="Add-ons">
        <Row
          icon={Megaphone} tint="bg-emerald-600" label="WhatsApp campaigns"
          description="Template campaigns to imported contacts, with AI handling the replies"
          hint={!ba.whatsappEnabled ? "Needs WhatsApp switched on to show up." : null}
          below={checklistLine("whatsappCampaigns")}
        >
          {setUpButton("whatsappCampaigns")}
          {flagSwitch("whatsappMarketingEnabled", "WhatsApp campaigns")}
        </Row>
        <Row
          icon={Mic} tint="bg-indigo-500" label="Voice mode"
          description="Visitors can talk to the website chat out loud"
          hint={!ba.chroneyEnabled ? "Needs Website chat switched on to show up." : null}
          below={statusLine(featureStatus.data?.voiceMode, voiceText, "text-voice-status")}
        >
          <Button variant="outline" size="sm" className="h-7" onClick={() => setVoiceOpen(true)} data-testid="button-feature-voice">
            Set up
          </Button>
          {flagSwitch("voiceModeEnabled", "Voice mode")}
        </Row>
        <Row
          icon={Camera} tint="bg-cyan-600" label="Visual product search"
          description="Visitors upload a photo in the website chat to find similar products"
          hint={!ba.chroneyEnabled ? "Needs Website chat switched on to show up." : null}
          below={ba.visualSearchEnabled ? photoStatusLine : null}
        >
          {setUpButton("visualSearch")}
          {flagSwitch("visualSearchEnabled", "Visual product search")}
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
        {tutor.data?.eligible && (
          <Row
            icon={GraduationCap} tint="bg-teal-600" label="AI tutor"
            description="Teaches a chapter like a teacher, with a live board; video when the avatar is on"
            hint={!ba.voiceModeEnabled ? "Needs Voice mode switched on to show up." : null}
          >
            <span className="text-[12.5px] text-gray-500" data-testid="text-tutor-status">
              {tutor.data.enabled ? `On · ${tutor.data.dailyMinutesPerStudent} min/student/day` : "Off"}
            </span>
            <Button variant="outline" size="sm" className="h-7" onClick={() => setTutorOpen(true)} data-testid="button-feature-tutor">
              Set up
            </Button>
          </Row>
        )}
        <Row icon={Headphones} tint="bg-orange-500" label="Support tickets" description="A queue for the questions the AI hands over to people" below={checklistLine("supportTickets")}>
          {setUpButton("supportTickets")}
          {flagSwitch("supportTicketsEnabled", "Support tickets")}
        </Row>
        <Row
          icon={Calendar} tint="bg-purple-600" label="Appointments"
          description="Visitors book appointments in the chat"
          hint={!ba.chroneyEnabled ? "Needs Website chat switched on to show up." : null}
          below={checklistLine("appointments")}
        >
          {setUpButton("appointments")}
          {flagSwitch("appointmentsEnabled", "Appointments")}
        </Row>
        <Row icon={PackageOpen} tint="bg-rose-500" label="Demo orders" description="Sample orders for showing order tracking and returns in demos" below={checklistLine("demoOrders")}>
          {setUpButton("demoOrders")}
          {flagSwitch("demoOrdersEnabled", "Demo orders")}
        </Row>
        <Row
          icon={ShoppingBag} tint="bg-green-600" label="Shopify"
          description="Bring products in from a Shopify store"
          hint={!hasProducts ? "Needs Website chat, WhatsApp or Vista switched on to show up." : null}
          below={checklistLine("shopify")}
        >
          {setUpButton("shopify")}
          {flagSwitch("shopifyEnabled", "Shopify")}
        </Row>
      </Group>

      <Group title="Where leads go">
        <Row
          icon={Link2} tint="bg-sky-600" label="CRM"
          description="LeadSquared, Salesforce, Meritto or a custom CRM"
          below={featureStatus.data?.crm?.state === "off"
            ? <p className="text-[12px] text-gray-500" data-testid="text-status-crm">No CRM set up: leads stay in AI Chroney only.</p>
            : checklistLine("crm")}
        >
          {setUpButton("crm")}
        </Row>
      </Group>

      <Group title="Industry modules">
        <Row icon={School} tint="bg-indigo-500" label="K12 education" description="Subjects, chapters and topics for schools; the AI tutor builds on it">
          {flagSwitch("k12EducationEnabled", "K12 education")}
        </Row>
        <Row icon={Briefcase} tint="bg-cyan-700" label="Job portal" description="Job listings, applicants and AI candidate matching">
          {flagSwitch("jobPortalEnabled", "Job portal")}
        </Row>
      </Group>

      <p className="px-1.5 text-[12.5px] text-gray-500">
        The same switches show in Super Admin › Business accounts › Features and in this account's Settings. Changes apply straight away for everyone on this account.
      </p>

      <FeatureSetupPanel
        feature={setupFeature}
        onOpenChange={(o) => { if (!o) setSetupFeature(null); }}
        businessAccountId={ba.id}
        businessName={ba.name}
        status={setupFeature ? statusOf(setupFeature) : undefined}
      />
      {voiceOpen && (
        <VoiceSetupPanel open={voiceOpen} onOpenChange={setVoiceOpen} businessAccountId={ba.id} businessName={ba.name} />
      )}
      {tutorOpen && (
        <TutorSettingsDialog open={tutorOpen} onOpenChange={setTutorOpen} businessAccountId={ba.id} businessName={ba.name} />
      )}
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
