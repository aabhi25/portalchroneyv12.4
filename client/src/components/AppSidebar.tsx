import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { SETTINGS_PATHS } from "@/pages/settings/settingsPaths";
import { SIDEBAR_GROUPS, findHubLocation, hubArea, visibleTabs, type HubArea } from "@/navigation/hubAreas";
import { useHubAccess, usesHubLayout } from "@/components/hub/HubFrame";
import { FindSetting } from "@/components/hub/FindSetting";
import { Button } from "@/components/ui/button";
import { Package, HelpCircle, ShieldCheck, LogOut, Contact, Home, Building2, Sparkles, Settings, Brain, BarChart3, MessageSquare, ShoppingBag, Calendar, GraduationCap, ChevronRight, Presentation, FileText, Key, LifeBuoy, ClipboardList, Route, Link2, Users, DollarSign, Percent, HardDrive, Gem, Image, Database, Camera, Globe, Lightbulb, MessageCircle, MoreHorizontal, Bot, TrendingUp, Zap, BookOpen, Library, HelpCircle as QuizIcon, Briefcase, UserCircle, Terminal, PackageOpen, Megaphone, FileCode2, UsersRound, ScrollText, Gauge } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import type { MeResponseDto } from "@shared/dto";

interface AppSidebarProps {
  user: MeResponseDto | null;
}

function NavItem({ icon: Icon, label, onClick, isActive, badge, testId, gradient }: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  isActive: boolean;
  badge?: number;
  testId?: string;
  gradient?: string;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={onClick}
        isActive={isActive}
        data-testid={testId}
        className={`group/nav relative transition-all duration-200 ${
          isActive
            ? 'bg-gradient-to-r from-purple-50 to-indigo-50 text-purple-700 font-medium shadow-sm border border-purple-100/60'
            : 'hover:bg-gray-50/80'
        }`}
      >
        <div className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all duration-200 ${
          isActive
            ? (gradient || 'bg-gradient-to-br from-purple-500 to-indigo-600')
            : 'bg-gray-100 group-hover/nav:bg-gray-200/80'
        }`}>
          <Icon className={`w-3.5 h-3.5 transition-colors ${isActive ? 'text-white' : 'text-gray-500 group-hover/nav:text-gray-700'}`} />
        </div>
        <span className="text-[14px]">{label}</span>
        {badge && badge > 0 ? (
          <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 h-5 min-w-5 flex items-center justify-center" data-testid="badge-ticket-count">
            {badge}
          </Badge>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const AREA_TEST_IDS: Partial<Record<HubArea["id"], string>> = {
  leads: "link-leads", website: "link-website-agent", whatsapp: "link-whatsapp", instagram: "link-instagram",
  facebook: "link-facebook", calls: "link-calling", training: "link-training", products: "link-products",
  appointments: "link-calendar", orders: "link-demo-orders", vista: "link-jewelry-showcase",
};

/** One area (an AI agent, Leads, Training, …) in the sidebar, with its own coloured icon. */
function AreaNavItem({ area, isActive, onClick, badge }: { area: HubArea; isActive: boolean; onClick: () => void; badge?: number }) {
  const Icon = area.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={onClick}
        isActive={isActive}
        data-testid={AREA_TEST_IDS[area.id] ?? `link-${area.id}`}
        className={`group/nav relative transition-all duration-200 ${
          isActive ? "bg-purple-50 text-purple-700 font-medium border border-purple-100/60" : "hover:bg-gray-50/80"
        }`}
      >
        <div className={`flex items-center justify-center w-7 h-7 rounded-lg ${area.tint}`}>
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-[14px]">{area.label}</span>
        {badge && badge > 0 ? (
          <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 h-5 min-w-5 flex items-center justify-center" data-testid="badge-ticket-count">
            {badge}
          </Badge>
        ) : null}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar({ user }: AppSidebarProps) {
  const [location, setLocation] = useLocation();

  const isSuperAdmin = user?.role === "super_admin";
  const isSuperAdminImpersonating = isSuperAdmin && !!user?.activeBusinessAccountId;
  const isGroupAdmin = user?.role === "account_group_admin";
  const showBusinessNav = (!isSuperAdmin && !isGroupAdmin) || isSuperAdminImpersonating;
  
  const isTopscholar = user?.businessAccount?.isTopscholar === true;
  
  const isEducationK12 = user?.businessAccount?.k12EducationEnabled === true;
  const isJobPortal = user?.businessAccount?.jobPortalEnabled === true;
  // The standard business layout: areas from navigation/hubAreas.ts.
  const hubAccess = useHubAccess(user);
  const currentAreaId = usesHubLayout(user) ? findHubLocation(location, hubAccess)?.area.id : undefined;

  const { data: ticketStats } = useQuery<{ open: number }>({
    queryKey: ["/api/tickets/stats"],
    enabled: showBusinessNav && !!user,
  });
  
  const openTicketCount = ticketStats?.open || 0;

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
      sessionStorage.removeItem("lastPath");
      queryClient.clear();
      window.location.href = "/";
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <Sidebar className="border-r-0 sidebar-ocean">
      <SidebarHeader className="p-4 border-b border-gray-100/80">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
            <img src="/c_logo.png" className="w-10 h-10 object-contain" alt="AI Chroney" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-sm bg-gradient-to-r from-purple-700 to-indigo-600 bg-clip-text text-transparent">AI Chroney</h2>
            {showBusinessNav && user?.businessAccountId && user?.businessAccount?.name ? (
              <AccountSwitcher 
                businessName={user.businessAccount.name}
                businessAccountId={user.businessAccountId}
              />
            ) : (
              // Business user view: show the account's name, as its own login does (no switcher — that's theirs).
              <p className="text-xs text-gray-400 font-medium">{user?.viewingAsBusinessUser ? user.businessAccount?.name : user?.username}</p>
            )}
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        {usesHubLayout(user) && <FindSetting access={hubAccess} />}
        {showBusinessNav && (
          <>
            {isJobPortal ? (
              <>
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu className="space-y-0.5">
                      <NavItem
                        icon={Home}
                        label="Home"
                        onClick={() => setLocation("/")}
                        isActive={location === "/"}
                        testId="link-home"
                        gradient="bg-gradient-to-br from-violet-500 to-purple-600"
                      />
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>

                <SidebarGroup>
                  <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold px-3 mb-1">Recruitment</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu className="space-y-0.5">
                      <NavItem
                        icon={Briefcase}
                        label="Jobs"
                        onClick={() => setLocation("/admin/jobs")}
                        isActive={location === "/admin/jobs"}
                        testId="link-jobs"
                        gradient="bg-gradient-to-br from-cyan-500 to-blue-600"
                      />
                      <NavItem
                        icon={UserCircle}
                        label="Applicants"
                        onClick={() => setLocation("/admin/applicants")}
                        isActive={location === "/admin/applicants"}
                        testId="link-applicants"
                        gradient="bg-gradient-to-br from-teal-500 to-cyan-600"
                      />
                      <NavItem
                        icon={MessageSquare}
                        label="Conversations"
                        onClick={() => setLocation("/conversations")}
                        isActive={location === "/conversations"}
                        testId="link-conversations"
                        gradient="bg-gradient-to-br from-green-500 to-emerald-600"
                      />
                      <NavItem
                        icon={Contact}
                        label="Leads"
                        onClick={() => setLocation("/admin/leads")}
                        isActive={location === "/admin/leads"}
                        testId="link-leads"
                        gradient="bg-gradient-to-br from-orange-500 to-amber-600"
                      />
                      <NavItem
                        icon={BarChart3}
                        label="Insights"
                        onClick={() => setLocation("/insights")}
                        isActive={location === "/insights"}
                        testId="link-insights"
                        gradient="bg-gradient-to-br from-purple-500 to-violet-600"
                      />
                      <NavItem
                        icon={GraduationCap}
                        label="Training"
                        onClick={() => setLocation("/admin/training")}
                        isActive={location === "/admin/training" || location === "/train-chroney" || location === "/conversation-journeys" || location === "/admin/faqs" || location === "/admin/about" || location === "/admin/scan-docs" || location === "/admin/url-training"}
                        testId="link-training"
                        gradient="bg-gradient-to-br from-violet-500 to-purple-600"
                      />
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </>
            ) : isEducationK12 ? (
              <>
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu className="space-y-0.5">
                      <NavItem
                        icon={Home}
                        label="Home"
                        onClick={() => setLocation("/")}
                        isActive={location === "/"}
                        testId="link-home"
                        gradient="bg-gradient-to-br from-violet-500 to-purple-600"
                      />
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>

                <SidebarGroup>
                  <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold px-3 mb-1">Education</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu className="space-y-0.5">
                      {!isTopscholar && (
                        <NavItem
                          icon={BookOpen}
                          label="Content"
                          onClick={() => setLocation("/admin/k12/content")}
                          isActive={location.startsWith("/admin/k12/content") || location.startsWith("/admin/k12/topic")}
                          testId="link-k12-content"
                          gradient="bg-gradient-to-br from-blue-500 to-indigo-600"
                        />
                      )}
                      {isTopscholar && (
                        <NavItem
                          icon={Library}
                          label="Ext. Content"
                          onClick={() => setLocation("/admin/topscholar/content")}
                          isActive={location.startsWith("/admin/topscholar/content")}
                          testId="link-topscholar-content"
                          gradient="bg-gradient-to-br from-cyan-500 to-blue-600"
                        />
                      )}
                      {isTopscholar && (
                        <NavItem
                          icon={Terminal}
                          label="Testing"
                          onClick={() => setLocation("/admin/topscholar/tester")}
                          isActive={location.startsWith("/admin/topscholar/tester")}
                          testId="link-topscholar-tester"
                          gradient="bg-gradient-to-br from-pink-500 to-rose-600"
                        />
                      )}
                      <NavItem
                        icon={MessageSquare}
                        label="Conversations"
                        onClick={() => setLocation("/conversations")}
                        isActive={location === "/conversations"}
                        testId="link-conversations"
                        gradient="bg-gradient-to-br from-green-500 to-emerald-600"
                      />
                      <NavItem
                        icon={Contact}
                        label="Students"
                        onClick={() => setLocation("/admin/leads")}
                        isActive={location === "/admin/leads"}
                        testId="link-students"
                        gradient="bg-gradient-to-br from-orange-500 to-amber-600"
                      />
                      {!isTopscholar && (
                        <NavItem
                          icon={BarChart3}
                          label="Insights"
                          onClick={() => setLocation("/insights")}
                          isActive={location === "/insights"}
                          testId="link-insights"
                          gradient="bg-gradient-to-br from-purple-500 to-violet-600"
                        />
                      )}
                      {isTopscholar && (
                        <NavItem
                          icon={TrendingUp}
                          label="Analytics"
                          onClick={() => setLocation("/admin/topscholar/analytics")}
                          isActive={location.startsWith("/admin/topscholar/analytics")}
                          testId="link-topscholar-analytics"
                          gradient="bg-gradient-to-br from-indigo-500 to-violet-600"
                        />
                      )}
                      <NavItem
                        icon={GraduationCap}
                        label="Training"
                        onClick={() => setLocation("/admin/training")}
                        isActive={location === "/admin/training" || location === "/train-chroney" || location === "/conversation-journeys" || location === "/admin/faqs" || location === "/admin/about" || location === "/admin/scan-docs" || location === "/admin/url-training"}
                        testId="link-training"
                        gradient="bg-gradient-to-br from-violet-500 to-purple-600"
                      />
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </>
            ) : (
            <>
            {SIDEBAR_GROUPS.map((group, gi) => {
              const areas = group.areas.map(hubArea).filter(a => a.visible(hubAccess));
              const showHome = gi === 0; // Home is the dashboard for every standard account
              if (areas.length === 0 && !showHome) return null;
              return (
                <SidebarGroup key={group.label ?? "top"}>
                  {group.label && areas.length > 0 && (
                    <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold px-3 mb-1">{group.label}</SidebarGroupLabel>
                  )}
                  <SidebarGroupContent>
                    <SidebarMenu className="space-y-0.5">
                      {showHome && (
                        <NavItem
                          icon={Home}
                          label="Home"
                          onClick={() => setLocation("/")}
                          isActive={location === "/"}
                          testId="link-home"
                          gradient="bg-gradient-to-br from-violet-500 to-purple-600"
                        />
                      )}
                      {areas.map(area => (
                        <AreaNavItem
                          key={area.id}
                          area={area}
                          isActive={currentAreaId === area.id}
                          onClick={() => setLocation(visibleTabs(area, hubAccess)[0]?.href ?? "/")}
                          badge={area.id === "website" && hubAccess.supportTickets ? openTicketCount : undefined}
                        />
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              );
            })}
            </>
            )}
          </>
        )}

        {isSuperAdmin && !isSuperAdminImpersonating ? (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold px-3 mb-1">Super Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-0.5">
                <NavItem icon={ShieldCheck} label="Business Accounts" onClick={() => setLocation("/super-admin")} isActive={location === "/super-admin"} testId="link-super-admin" gradient="bg-gradient-to-br from-purple-500 to-violet-600" />
                <NavItem icon={BarChart3} label="Insights" onClick={() => setLocation("/super-admin/insights")} isActive={location === "/super-admin/insights"} testId="link-super-admin-insights" gradient="bg-gradient-to-br from-blue-500 to-indigo-600" />
                <NavItem icon={DollarSign} label="Cost Analytics" onClick={() => setLocation("/super-admin/costs")} isActive={location === "/super-admin/costs"} testId="link-super-admin-costs" gradient="bg-gradient-to-br from-emerald-500 to-green-600" />
                <NavItem icon={Gauge} label="Usage & Limits" onClick={() => setLocation("/super-admin/usage")} isActive={location === "/super-admin/usage"} testId="link-super-admin-usage" gradient="bg-gradient-to-br from-teal-500 to-emerald-600" />
                <NavItem icon={Presentation} label="Demo" onClick={() => setLocation("/super-admin/demo")} isActive={location === "/super-admin/demo"} testId="link-super-admin-demo" gradient="bg-gradient-to-br from-amber-500 to-orange-600" />
                <NavItem icon={Key} label="API Keys" onClick={() => setLocation("/super-admin/api-keys")} isActive={location === "/super-admin/api-keys"} testId="link-super-admin-api-keys" gradient="bg-gradient-to-br from-rose-500 to-pink-600" />
                <NavItem icon={Bot} label="Chat APIs" onClick={() => setLocation("/super-admin/chat-apis")} isActive={location === "/super-admin/chat-apis"} testId="link-super-admin-chat-apis" gradient="bg-gradient-to-br from-cyan-500 to-teal-600" />
                <NavItem icon={Link2} label="Account Groups" onClick={() => setLocation("/super-admin/account-groups")} isActive={location === "/super-admin/account-groups"} testId="link-super-admin-account-groups" gradient="bg-gradient-to-br from-indigo-500 to-purple-600" />
                <NavItem icon={ClipboardList} label="MIS" onClick={() => setLocation("/super-admin/mis")} isActive={location === "/super-admin/mis"} testId="link-super-admin-mis" gradient="bg-gradient-to-br from-fuchsia-500 to-pink-600" />
                <NavItem icon={Globe} label="Server Info" onClick={() => setLocation("/super-admin/server-info")} isActive={location === "/super-admin/server-info"} testId="link-super-admin-server-info" gradient="bg-gradient-to-br from-slate-500 to-gray-700" />
                <NavItem icon={Terminal} label="Live Logs" onClick={() => setLocation("/super-admin/live-logs")} isActive={location === "/super-admin/live-logs"} testId="link-super-admin-live-logs" gradient="bg-gradient-to-br from-green-700 to-emerald-900" />
                <NavItem icon={ScrollText} label="Audit Logs" onClick={() => setLocation("/super-admin/audit-logs")} isActive={location === "/super-admin/audit-logs"} testId="link-super-admin-audit-logs" gradient="bg-gradient-to-br from-slate-600 to-zinc-800" />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : isGroupAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold px-3 mb-1">Group Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-0.5">
                <NavItem icon={Users} label="Leads" onClick={() => setLocation("/group-admin/leads")} isActive={location === "/group-admin/leads"} testId="link-group-admin-leads" gradient="bg-gradient-to-br from-orange-500 to-amber-600" />
                <NavItem icon={MessageSquare} label="Conversations" onClick={() => setLocation("/group-admin/conversations")} isActive={location === "/group-admin/conversations"} testId="link-group-admin-conversations" gradient="bg-gradient-to-br from-emerald-500 to-teal-600" />

                <NavItem icon={Lightbulb} label="Account Insights" onClick={() => setLocation("/group-admin/insights")} isActive={location === "/group-admin/insights"} testId="link-group-admin-insights" gradient="bg-gradient-to-br from-yellow-500 to-amber-600" />
                <NavItem icon={TrendingUp} label="Group Analytics" onClick={() => setLocation("/group-admin/group-analytics")} isActive={location === "/group-admin/group-analytics"} testId="link-group-admin-group-analytics" gradient="bg-gradient-to-br from-purple-500 to-pink-600" />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-gray-100/80">
        <SidebarMenu className="space-y-0.5">
          <NavItem
            icon={Settings}
            label="Settings"
            onClick={() => setLocation(isSuperAdmin && !isSuperAdminImpersonating ? "/super-admin/settings" : SETTINGS_PATHS.root)}
            isActive={location === SETTINGS_PATHS.root || location.startsWith(`${SETTINGS_PATHS.root}/`) || location === "/super-admin/settings"}
            testId="link-settings"
            gradient="bg-gradient-to-br from-slate-500 to-gray-600"
          />
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleLogout}
              data-testid="button-logout"
              className="group/nav transition-all duration-200 hover:bg-red-50/80"
            >
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100 group-hover/nav:bg-red-100 transition-all duration-200">
                <LogOut className="w-3.5 h-3.5 text-gray-500 group-hover/nav:text-red-500 transition-colors" />
              </div>
              <span className="text-[14px] group-hover/nav:text-red-600 transition-colors">Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
