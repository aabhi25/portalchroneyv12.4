import { useState, useEffect, useRef } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { WhatsAppSectionPanel } from "@/components/whatsapp/WhatsAppSectionPanel";
import { getWhatsappSections } from "@/components/whatsapp/sections";
import AdminProducts from "@/pages/AdminProducts";
import WhatsAppCampaigns from "@/pages/WhatsAppCampaigns";
import WhatsAppCampaignAutomations from "@/pages/WhatsAppCampaignAutomations";
import WhatsAppCampaignAutomationForm from "@/pages/WhatsAppCampaignAutomationForm";
import WhatsAppCampaignAutomationDetail from "@/pages/WhatsAppCampaignAutomationDetail";
import WhatsAppNewCampaign from "@/pages/WhatsAppNewCampaign";
import WhatsAppCampaignDetail from "@/pages/WhatsAppCampaignDetail";
import WhatsAppCampaignConversations from "@/pages/WhatsAppCampaignConversations";
import WhatsAppCampaignHome from "@/pages/WhatsAppCampaignHome";
import WhatsAppCampaignResults from "@/pages/WhatsAppCampaignResults";
import WhatsAppOptOuts from "@/pages/WhatsAppOptOuts";
import WhatsAppAiWorkbooks from "@/pages/WhatsAppAiWorkbooks";
import WhatsAppEditCampaign from "@/pages/WhatsAppEditCampaign";
import WhatsAppTemplates from "@/pages/WhatsAppTemplates";
import WhatsAppContactGroups from "@/pages/WhatsAppContactGroups";
import { RequireWhatsappMarketing } from "@/components/RequireWhatsappMarketing";
import WhatsAppContactGroupDetail from "@/pages/WhatsAppContactGroupDetail";
import AdminFaqs from "@/pages/AdminFaqs";
import AdminLeads from "@/pages/AdminLeads";
import QuestionBank from "@/pages/QuestionBank";
import SupportTickets from "@/pages/support-tickets";
import TicketDetail from "@/pages/ticket-detail";
import AutomationAnalytics from "@/pages/automation-analytics";
import About from "@/pages/About";
import SettingsHub from "@/pages/SettingsHub";
import { SETTINGS_PATHS, LEGACY_SETTINGS_REDIRECTS } from "@/pages/settings/settingsPaths";
import TrainChroney from "@/pages/TrainChroney";
import Insights from "@/pages/Insights";
import AIInsights from "@/pages/AIInsights";
import Conversations from "@/pages/Conversations";
import Calendar from "@/pages/Calendar";
import SuperAdmin from "@/pages/SuperAdmin";
import SuperAdminSettings from "@/pages/SuperAdminSettings";
import SuperAdminInsights from "@/pages/SuperAdminInsights";
import SuperAdminCosts from "@/pages/SuperAdminCosts";
import SuperAdminUsage from "@/pages/SuperAdminUsage";
import SuperAdminMIS from "@/pages/SuperAdminMIS";
import SuperAdminDemo from "@/pages/SuperAdminDemo";
import SuperAdminApiKeys from "@/pages/SuperAdminApiKeys";
import SuperAdminChatApis from "@/pages/SuperAdminChatApis";
import SuperAdminAccountGroups from "@/pages/SuperAdminAccountGroups";
import GroupInsightsPage from "@/pages/GroupInsightsPage";
import GroupTrainingEditor from "@/pages/GroupTrainingEditor";
import SuperAdminR2Settings from "@/pages/SuperAdminR2Settings";
import SuperAdminServerInfo from "@/pages/SuperAdminServerInfo";
import SuperAdminLiveLogs from "@/pages/SuperAdminLiveLogs";
import SuperAdminAuditLogs from "@/pages/SuperAdminAuditLogs";
import PublicDemo from "@/pages/PublicDemo";
import PublicChat from "@/pages/PublicChat";
import Login from "@/pages/Login";
import ChangePassword from "@/pages/ChangePassword";
import ResetPassword from "@/pages/ResetPassword";
import Home from "@/pages/Home";
import EmbedChat from "@/pages/EmbedChat";
import GuidanceChat from "@/pages/GuidanceChat";
import VoiceEmbed from "@/pages/VoiceEmbed";
import VoiceOrbEmbed from "@/pages/VoiceOrbEmbed";
import ImportExcel from "@/pages/ImportExcel";
import Shopify from "@/pages/Shopify";
import DemoOrders from "@/pages/DemoOrders";
import ScanDocs from "@/pages/ScanDocs";
import UrlTraining from "@/pages/UrlTraining";
import ConversationJourneys from "@/pages/ConversationJourneys";
import GuidanceCampaigns from "@/pages/GuidanceCampaigns";
import EditGuidanceCampaign from "@/pages/EditGuidanceCampaign";
import GuidanceCampaignSettings from "@/pages/GuidanceCampaignSettings";
import EditProactiveGuidanceRule from "@/pages/EditProactiveGuidanceRule";
import SmartDiscountsHub from "@/pages/SmartDiscountsHub";
import UrgencyOffersSettings from "@/pages/UrgencyOffersSettings";
import ExitIntentSettings from "@/pages/ExitIntentSettings";
import IdleTimeoutSettings from "@/pages/IdleTimeoutSettings";
import JewelryShowcase from "@/pages/JewelryShowcase";
import VistaInsights from "@/pages/VistaInsights";
import Uploads from "@/pages/Uploads";
import SuperAdminGooglePhotos from "@/pages/SuperAdminGooglePhotos";
import JewelryImageGenerator from "@/pages/JewelryImageGenerator";
import GroupAdminDashboard from "@/pages/GroupAdminDashboard";
import GroupAdminInsights from "@/pages/GroupAdminInsights";
import GroupAnalytics from "@/pages/GroupAnalytics";
import RazorpayRizeDemo from "@/pages/RazorpayRizeDemo";
import WhatsApp from "@/pages/WhatsApp";
import WhatsAppSectionHub from "@/pages/WhatsAppSectionHub";
import StoreSheet from "@/pages/StoreSheet";
import WhatsAppAISetup from "@/pages/WhatsAppAISetup";
import DocumentTypeEditor from "@/pages/DocumentTypeEditor";
import WAInsights from "@/pages/WAInsights";
import InstagramConversations from "@/pages/InstagramConversations";
import InstagramFlows from "@/pages/InstagramFlows";
import InstagramLeads from "@/pages/InstagramLeads";
import InstagramInsights from "@/pages/InstagramInsights";
import InstagramComments from "@/pages/InstagramComments";
import InstagramHome from "@/pages/InstagramHome";
import FacebookHome from "@/pages/FacebookHome";
import FacebookConversations from "@/pages/FacebookConversations";
import FacebookLeads from "@/pages/FacebookLeads";
import FacebookFlows from "@/pages/FacebookFlows";
import FacebookInsights from "@/pages/FacebookInsights";
import FacebookComments from "@/pages/FacebookComments";
import TrainingHome from "@/pages/TrainingHome";
import MoreFeatures from "@/pages/MoreFeatures";
import MenuBuilder from "@/pages/MenuBuilder";
import SmartReplies from "@/pages/SmartReplies";
import WebsiteAgent from "@/pages/WebsiteAgent";
import TrainingNavTabs from "@/components/TrainingNavTabs";
import K12Content from "@/pages/K12Content";
import K12TopicDetail from "@/pages/K12TopicDetail";
import K12Guardrails from "@/pages/K12Guardrails";
import TopScholarAdmin from "@/pages/TopScholarAdmin";
import TopScholarContent from "@/pages/TopScholarContent";
import TopScholarWidgetTester from "@/pages/TopScholarWidgetTester";
import TopScholarAnalytics from "@/pages/TopScholarAnalytics";
import TopScholarDebug from "@/pages/TopScholarDebug";
import ContentSync from "@/pages/ContentSync";
import { isTopScholarSuperAdminView } from "@/lib/accountAccess";
import JobPortalJobs from "@/pages/JobPortalJobs";
import JobPortalApplicants from "@/pages/JobPortalApplicants";
import NotFound from "@/pages/not-found";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { UsageLimitBanner } from "@/components/UsageLimitBanner";
import type { MeResponseDto } from "@shared/dto";

function AppContent({ currentUser }: { currentUser: MeResponseDto | null }) {
  const [location, setLocation] = useLocation();
  const [user, setUser] = useState<MeResponseDto | null>(currentUser);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
    }
    if (location && location !== "/" && !location.startsWith("/embed/") && !location.startsWith("/demo/") && !location.startsWith("/public-chat/")) {
      sessionStorage.setItem("lastPath", location);
    }
  }, [location]);

  useEffect(() => {
    if (currentUser) {
      setUser(currentUser);
      const isPasswordExpired = currentUser.tempPasswordExpiry && new Date(currentUser.tempPasswordExpiry) < new Date();
      if (currentUser.mustChangePassword === "true" || isPasswordExpired) {
        setLocation("/change-password");
      }
    }
  }, [currentUser, setLocation]);

  const handleLogin = (loggedInUser: MeResponseDto) => {
    setUser(loggedInUser);
  };

  // Public routes (no authentication required)
  if (location.startsWith("/reset-password")) {
    return <ResetPassword />;
  }

  if (location.startsWith("/embed/guidance")) {
    return <GuidanceChat />;
  }

  if (location.startsWith("/embed/voice-orb")) {
    return <VoiceOrbEmbed />;
  }

  if (location.startsWith("/embed/voice")) {
    return <VoiceEmbed />;
  }

  if (location.startsWith("/embed/chat")) {
    return <EmbedChat />;
  }

  if (location.startsWith("/demo/razorpay-rize")) {
    return <RazorpayRizeDemo />;
  }

  if (location.startsWith("/demo/")) {
    return <PublicDemo />;
  }

  if (location.startsWith("/public-chat/")) {
    return <PublicChat />;
  }

  // Show login page if not authenticated
  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  // Show change password page if required
  if (location === "/change-password") {
    return <ChangePassword />;
  }

  // Check if SuperAdmin is impersonating a business account
  const isSuperAdminImpersonating = user?.role === "super_admin" && user?.activeBusinessAccountId;
  const canManageTopScholarContent = isTopScholarSuperAdminView(user);
  const isTopScholarAccount = user?.businessAccount?.isTopscholar === true;

  // Authenticated routes
  return (
    <>
      <AppSidebar user={user} />
      <SidebarInset>
        {/* Show impersonation banner for SuperAdmins */}
        {user?.role === "super_admin" && <ImpersonationBanner />}
        {/* Monthly AI limit: full details for super admins viewing as an account; business users only learn when AI replies are paused. */}
        {(user?.role !== "account_group_admin" && (user?.role !== "super_admin" || isSuperAdminImpersonating)) && <UsageLimitBanner showSpend={user?.role === "super_admin"} />}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 lg:hidden sticky top-0 z-10">
          <SidebarTrigger className="-ml-1" />
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">AI Chroney</h1>
          </div>
        </header>
        <div className="flex-1 overflow-auto">
          <WhatsAppSectionPanel user={user}>
          <Switch>
            <Route path="/admin/content-sync">
              {() => canManageTopScholarContent ? <ContentSync /> : <Redirect to="/" />}
            </Route>
            {user?.role === "super_admin" && !isSuperAdminImpersonating ? (
              <>
                <Route path="/">
                  {(() => {
                    if (isInitialLoad.current) {
                      const lastPath = sessionStorage.getItem("lastPath");
                      if (lastPath && lastPath.startsWith("/super-admin")) {
                        return <Redirect to={lastPath} />;
                      }
                    }
                    return <Redirect to="/super-admin" />;
                  })()}
                </Route>
                <Route path="/super-admin" component={SuperAdmin} />
                <Route path="/admin/insights" component={SuperAdminInsights} />
                <Route path="/super-admin/insights" component={SuperAdminInsights} />
                <Route path="/super-admin/costs" component={SuperAdminCosts} />
                <Route path="/super-admin/usage" component={SuperAdminUsage} />
                <Route path="/super-admin/mis" component={SuperAdminMIS} />
                <Route path="/super-admin/demo" component={SuperAdminDemo} />
                <Route path="/super-admin/api-keys" component={SuperAdminApiKeys} />
                <Route path="/super-admin/chat-apis" component={SuperAdminChatApis} />
                <Route path="/super-admin/google-photos" component={SuperAdminGooglePhotos} />
                <Route path="/super-admin/account-groups" component={SuperAdminAccountGroups} />
                <Route path="/super-admin/account-groups/:groupId/insights" component={GroupInsightsPage} />
                <Route path="/super-admin/account-groups/:groupId/training" component={GroupTrainingEditor} />
                <Route path="/super-admin/settings" component={SuperAdminSettings} />
                <Route path="/super-admin/r2-storage" component={SuperAdminR2Settings} />
                <Route path="/super-admin/server-info" component={SuperAdminServerInfo} />
                <Route path="/super-admin/live-logs" component={SuperAdminLiveLogs} />
                <Route path="/super-admin/audit-logs" component={SuperAdminAuditLogs} />
              </>
            ) : user?.role === "account_group_admin" ? (
              <>
                <Route path="/">
                  {(() => {
                    if (isInitialLoad.current) {
                      const lastPath = sessionStorage.getItem("lastPath");
                      if (lastPath && lastPath.startsWith("/group-admin")) {
                        return <Redirect to={lastPath} />;
                      }
                    }
                    return <Redirect to="/group-admin/leads" />;
                  })()}
                </Route>
                <Route path="/group-admin">
                  <Redirect to="/group-admin/leads" />
                </Route>
                <Route path="/group-admin/leads" component={GroupAdminDashboard} />
                <Route path="/group-admin/conversations" component={GroupAdminDashboard} />

                <Route path="/group-admin/insights" component={GroupAdminInsights} />
                <Route path="/group-admin/group-analytics" component={GroupAnalytics} />
                <Route path={SETTINGS_PATHS.root}>{() => <SettingsHub user={user} />}</Route>
                <Route path={`${SETTINGS_PATHS.root}/*`}>{() => <SettingsHub user={user} />}</Route>
              </>
            ) : (
              <>
                <Route path="/">
                  {(() => {
                    if (isInitialLoad.current) {
                      const lastPath = sessionStorage.getItem("lastPath");
                      if (lastPath && lastPath.startsWith("/admin")) {
                        return <Redirect to={lastPath} />;
                      }
                      if (user?.businessAccount?.productTier === 'jewelry_showcase') {
                        return <Redirect to={lastPath && lastPath.startsWith("/jewelry") ? lastPath : "/jewelry-showcase"} />;
                      }
                    }
                    if (user?.businessAccount?.productTier === 'jewelry_showcase') {
                      return <Redirect to="/jewelry-showcase" />;
                    }
                    if (user?.businessAccount?.whatsappEnabled === true && user?.businessAccount?.chroneyEnabled !== true) {
                      return <Redirect to="/admin/whatsapp-leads" />;
                    }
                    if (user?.businessAccount?.instagramEnabled === true && user?.businessAccount?.chroneyEnabled !== true && user?.businessAccount?.whatsappEnabled !== true) {
                      return <Redirect to={SETTINGS_PATHS.instagramConnection} />;
                    }
                    return <Home />;
                  })()}
                </Route>
                <Route path="/insights">
                  {() => isTopScholarAccount ? <Redirect to="/admin/topscholar/analytics" /> : <Insights />}
                </Route>
                <Route path="/ai-insights" component={AIInsights} />
                <Route path="/conversations" component={Conversations} />
                <Route path="/train-chroney" component={TrainChroney} />
                <Route path="/admin/k12/content">
                  {() => isTopScholarAccount ? <Redirect to="/admin/topscholar/content" /> : <K12Content />}
                </Route>
                <Route path="/admin/k12/topic/:id">
                  {() => isTopScholarAccount ? <Redirect to="/admin/topscholar/content" /> : <K12TopicDetail />}
                </Route>
                <Route path="/admin/k12/external-api">
                  <Redirect to="/admin/topscholar" />
                </Route>
                <Route path="/admin/k12/guardrails" component={K12Guardrails} />
                <Route path="/admin/topscholar" component={TopScholarAdmin} />
                <Route path="/admin/topscholar/content" component={TopScholarContent} />
                <Route path="/admin/topscholar/tester" component={TopScholarWidgetTester} />
                <Route path="/admin/topscholar/analytics" component={TopScholarAnalytics} />
                <Route path="/admin/topscholar/debug" component={TopScholarDebug} />
                <Route path="/admin/jobs" component={JobPortalJobs} />
                <Route path="/admin/applicants" component={JobPortalApplicants} />
                <Route path="/admin/products" component={AdminProducts} />
                <Route path="/products/import-excel" component={ImportExcel} />
                <Route path="/admin/shopify" component={Shopify} />
                <Route path="/admin/demo-orders" component={DemoOrders} />
                <Route path="/admin/smart-discounts" component={SmartDiscountsHub} />
                <Route path="/admin/smart-discounts/urgency-offers" component={UrgencyOffersSettings} />
                <Route path="/admin/smart-discounts/exit-intent" component={ExitIntentSettings} />
                <Route path="/admin/smart-discounts/idle-timeout" component={IdleTimeoutSettings} />
                <Route path="/jewelry-showcase" component={JewelryShowcase} />
                <Route path="/vista-insights" component={VistaInsights} />
                <Route path="/admin/uploads" component={Uploads} />
                <Route path="/admin/jewelry-image-generator" component={JewelryImageGenerator} />
                <Route path="/admin/faqs" component={AdminFaqs} />
                <Route path="/admin/leads" component={AdminLeads} />
                <Route path="/question-bank" component={QuestionBank} />
                <Route path="/conversation-journeys" component={ConversationJourneys} />
                <Route path="/guidance-campaigns/:id/settings" component={GuidanceCampaignSettings} />
                <Route path="/guidance-campaigns/:id" component={EditGuidanceCampaign} />
                <Route path="/guidance-campaigns" component={GuidanceCampaigns} />
                <Route path="/proactive-guidance/:id" component={EditProactiveGuidanceRule} />
                <Route path="/tickets/:id" component={TicketDetail} />
                <Route path="/tickets" component={SupportTickets} />
                <Route path="/automation-analytics" component={AutomationAnalytics} />
                <Route path="/admin/calendar" component={Calendar} />
                <Route path="/admin/whatsapp">
                  {() => {
                    const wa = user?.businessAccount;
                    const marketingEnabled = wa?.whatsappEnabled === true && wa?.whatsappMarketingEnabled === true;
                    // Derive from the shared section definition so this redirect can't drift
                    // when sections are reordered.
                    const firstHref = getWhatsappSections({ marketingEnabled })[0].items[0].href;
                    return <Redirect to={firstHref} />;
                  }}
                </Route>
                <Route path="/admin/whatsapp-hub/:sectionId" component={WhatsAppSectionHub} />
                <Route path="/admin/whatsapp-conversations">{() => <WhatsApp />}</Route>
                <Route path="/admin/whatsapp-leads">{() => <WhatsApp />}</Route>
                <Route path="/admin/whatsapp-flows">{() => <WhatsApp />}</Route>
                <Route path="/admin/whatsapp-dealers-stores" component={StoreSheet} />
                <Route path="/admin/whatsapp-ai-setup" component={WhatsAppAISetup} />
                <Route path="/admin/document-type-editor/:id" component={DocumentTypeEditor} />
                <Route path="/admin/document-type-editor" component={DocumentTypeEditor} />
                <Route path="/admin/whatsapp-smart-replies">{() => <SmartReplies channel="whatsapp" />}</Route>
                <Route path="/admin/whatsapp-campaign-home">{() => <RequireWhatsappMarketing><WhatsAppCampaignHome /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-campaign-results">{() => <RequireWhatsappMarketing><WhatsAppCampaignResults /></RequireWhatsappMarketing>}</Route>
                {/* Plain-language aliases; the original URLs below keep working. */}
                <Route path="/admin/whatsapp-campaign-replies"><Redirect to="/admin/whatsapp-campaign-conversations" /></Route>
                <Route path="/admin/whatsapp-audiences"><Redirect to="/admin/whatsapp-contact-groups" /></Route>
                <Route path="/admin/whatsapp-opt-outs">{() => <RequireWhatsappMarketing><WhatsAppOptOuts /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-campaign-conversations">{() => <RequireWhatsappMarketing><WhatsAppCampaignConversations /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-ai-workbooks/:id">{({ id }) => <RequireWhatsappMarketing><WhatsAppAiWorkbooks id={id} /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-ai-workbooks">{() => <RequireWhatsappMarketing><WhatsAppAiWorkbooks /></RequireWhatsappMarketing>}</Route>
                 <Route path="/admin/whatsapp-campaign-automations/new">{() => <RequireWhatsappMarketing><WhatsAppCampaignAutomationForm /></RequireWhatsappMarketing>}</Route>
                 <Route path="/admin/whatsapp-campaign-automations/:id/edit">{({ id }) => <RequireWhatsappMarketing><WhatsAppCampaignAutomationForm id={id} /></RequireWhatsappMarketing>}</Route>
                 <Route path="/admin/whatsapp-campaign-automations/:id">{({ id }) => <RequireWhatsappMarketing><WhatsAppCampaignAutomationDetail id={id} /></RequireWhatsappMarketing>}</Route>
                 <Route path="/admin/whatsapp-campaign-automations">{() => <RequireWhatsappMarketing><WhatsAppCampaignAutomations /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-campaigns/new">{() => <RequireWhatsappMarketing><WhatsAppNewCampaign /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-campaigns/:id/edit">{() => <RequireWhatsappMarketing><WhatsAppEditCampaign /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-campaigns/:id">{() => <RequireWhatsappMarketing><WhatsAppCampaignDetail /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-campaigns">{() => <RequireWhatsappMarketing><WhatsAppCampaigns /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-templates">{() => <RequireWhatsappMarketing><WhatsAppTemplates /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-contact-groups/:id">{() => <RequireWhatsappMarketing><WhatsAppContactGroupDetail /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-contact-groups">{() => <RequireWhatsappMarketing><WhatsAppContactGroups /></RequireWhatsappMarketing>}</Route>
                <Route path="/admin/whatsapp-whitelist">{() => <WhatsApp />}</Route>
                <Route path="/admin/wa-insights" component={WAInsights} />
                <Route path="/admin/training" component={TrainingHome} />
                <Route path="/admin/instagram" component={InstagramHome} />
                <Route path="/admin/instagram-conversations" component={InstagramConversations} />
                <Route path="/admin/instagram-flows" component={InstagramFlows} />
                <Route path="/admin/instagram-leads">{() => <InstagramLeads />}</Route>
                <Route path="/admin/instagram-insights" component={InstagramInsights} />
                <Route path="/admin/instagram-comments" component={InstagramComments} />
                <Route path="/admin/instagram-smart-replies">{() => <SmartReplies channel="instagram" />}</Route>
                <Route path="/admin/facebook" component={FacebookHome} />
                <Route path="/admin/facebook-conversations" component={FacebookConversations} />
                <Route path="/admin/facebook-leads" component={FacebookLeads} />
                <Route path="/admin/facebook-flows" component={FacebookFlows} />
                <Route path="/admin/facebook-insights" component={FacebookInsights} />
                <Route path="/admin/facebook-comments" component={FacebookComments} />
                <Route path="/admin/facebook-smart-replies">{() => <SmartReplies channel="facebook" />}</Route>
                <Route path="/admin/about" component={About} />
                <Route path="/admin/scan-docs" component={ScanDocs} />
                <Route path="/admin/url-training" component={UrlTraining} />
                <Route path="/admin/website" component={WebsiteAgent} />
                <Route path="/admin/more">{() => <MoreFeatures user={user} />}</Route>
                <Route path="/admin/menu-builder" component={MenuBuilder} />
                <Route path="/admin/smart-replies">
                  <SmartReplies channel="website" headerContent={<TrainingNavTabs />} />
                </Route>
                {/* Settings hub. Old standalone settings routes redirect into it (query string kept). */}
                <Route path={SETTINGS_PATHS.root}>{() => <SettingsHub user={user} />}</Route>
                <Route path={`${SETTINGS_PATHS.root}/*`}>{() => <SettingsHub user={user} />}</Route>
                {Object.entries(LEGACY_SETTINGS_REDIRECTS).map(([from, to]) => (
                  <Route key={from} path={from}>{() => <Redirect to={`${to}${window.location.search}`} replace />}</Route>
                ))}
              </>
            )}
            <Route component={NotFound} />
          </Switch>
          </WhatsAppSectionPanel>
        </div>
      </SidebarInset>
    </>
  );
}

function AppWithProviders() {
  const [location] = useLocation();
  const style = {
    "--sidebar-width": "13rem",
    "--sidebar-width-icon": "4rem",
  } as React.CSSProperties;

  // Skip auth check for public routes
  const isPublicRoute = location.startsWith("/embed/chat") || location.startsWith("/reset-password") || location.startsWith("/public-chat/") || location.startsWith("/demo/");

  // Check authentication status ONCE (skip for public routes)
  const { data: currentUser, isLoading: authLoading } = useQuery<MeResponseDto>({
    queryKey: ["/api/auth/me"],
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    enabled: !isPublicRoute,
  });

  // Render public routes immediately without auth check
  if (isPublicRoute) {
    if (location.startsWith("/embed/chat")) {
      return <EmbedChat />;
    }
    if (location.startsWith("/reset-password")) {
      return <ResetPassword />;
    }
    if (location.startsWith("/demo/razorpay-rize")) {
      return <RazorpayRizeDemo />;
    }
    if (location.startsWith("/demo/")) {
      return <PublicDemo />;
    }
    if (location.startsWith("/public-chat/")) {
      return <PublicChat />;
    }
  }

  // Show centered loading while checking auth
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-background">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-base text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <SidebarProvider style={style} defaultOpen={true}>
        <AppContent currentUser={currentUser || null} />
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppWithProviders />
    </QueryClientProvider>
  );
}

export default App;
