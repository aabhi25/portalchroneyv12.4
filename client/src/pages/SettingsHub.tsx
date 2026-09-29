import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, ChevronRight, ExternalLink, AlertCircle, Settings2 } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { MeResponseDto } from "@shared/dto";
import { buildSettingsGroups, findSettingsItem, type SettingsGroup, type SettingsItem } from "./settings/settingsNav";
import { SETTINGS_PATHS } from "./settings/settingsPaths";

/** Keeps one broken settings screen from taking the whole app down. */
class SettingsErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Settings] screen crashed:", error, info.componentStack);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">This settings screen couldn't be shown. Reload the page and try again.</span>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Reload</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

const itemTarget = (item: SettingsItem) => item.path ?? item.href ?? SETTINGS_PATHS.root;

function NavList({ groups, activeKey, onNavigate }: { groups: SettingsGroup[]; activeKey: string | null; onNavigate: (to: string) => void }) {
  return (
    <nav aria-label="Settings" className="space-y-5">
      {groups.map((group) => {
        let lastSubgroup: string | undefined;
        return (
          <div key={group.id}>
            <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const showSub = item.subgroup && item.subgroup !== lastSubgroup;
                lastSubgroup = item.subgroup;
                const active = item.key === activeKey;
                const Icon = item.icon;
                return (
                  <li key={item.key}>
                    {showSub && (
                      <p className="px-3 pt-2 pb-0.5 text-[11px] font-medium text-gray-500">{item.subgroup}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => onNavigate(itemTarget(item))}
                      aria-current={active ? "page" : undefined}
                      data-testid={`settings-nav-${item.key}`}
                      className={`w-full flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-[13px] transition-colors ${
                        active ? "bg-purple-50 text-purple-700 font-medium" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                      } ${item.subgroup ? "pl-5" : ""}`}
                    >
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? "text-purple-600" : "text-gray-400"}`} />
                      <span className="truncate">{item.label}</span>
                      {item.href && <ExternalLink className="w-3 h-3 ml-auto text-gray-300" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function MobileNav({ groups, activeKey, onNavigate }: { groups: SettingsGroup[]; activeKey: string | null; onNavigate: (to: string) => void }) {
  const all = groups.flatMap((g) => g.items);
  return (
    <div className="md:hidden mb-5">
      <Select
        value={activeKey ?? "__overview"}
        onValueChange={(key) => {
          if (key === "__overview") return onNavigate(SETTINGS_PATHS.root);
          const item = all.find((i) => i.key === key);
          if (item) onNavigate(itemTarget(item));
        }}
      >
        <SelectTrigger aria-label="Choose a settings page" data-testid="settings-nav-mobile">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__overview">All settings</SelectItem>
          {groups.map((group) => (
            <SelectGroup key={group.id}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.items.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.subgroup ? `${item.subgroup} · ${item.label}` : item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Overview({ groups, onNavigate }: { groups: SettingsGroup[]; onNavigate: (to: string) => void }) {
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`settings-group-${group.id}`}>
          <h2 id={`settings-group-${group.id}`} className="text-sm font-semibold text-gray-900 mb-3">{group.label}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Card
                  key={item.key}
                  role="link"
                  tabIndex={0}
                  onClick={() => onNavigate(itemTarget(item))}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigate(itemTarget(item)); } }}
                  className="cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                  data-testid={`settings-card-${item.key}`}
                >
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="rounded-lg bg-purple-50 p-2 shrink-0">
                      <Icon className="w-4 h-4 text-purple-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-gray-900 flex items-center gap-1">
                        {item.subgroup ? `${item.subgroup} · ${item.label}` : item.label}
                        {item.href && <ExternalLink className="w-3 h-3 text-gray-400" />}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The Settings hub (/admin/settings and /admin/settings/...): one place for every account,
 * channel, integration and privacy setting. Each entry renders the existing settings screen
 * inside this layout; the old standalone routes redirect here (see LEGACY_SETTINGS_REDIRECTS).
 */
export default function SettingsHub({ user }: { user: MeResponseDto | null }) {
  const [location, setLocation] = useLocation();
  const groups = buildSettingsGroups(user);
  const match = location === SETTINGS_PATHS.root ? null : findSettingsItem(groups, location);
  const isOverview = location === SETTINGS_PATHS.root;
  const activeKey = match?.item.key ?? null;

  const header = (
    <header className="hidden lg:flex items-center h-14 px-6 border-b bg-white shrink-0">
      <SidebarTrigger className="-ml-1 mr-2" />
      <h1 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-purple-600" />
        Settings
      </h1>
    </header>
  );

  // Wide screens (the widget studio) get the full width, with a way back instead of the side nav.
  if (match?.item.wide && match.item.render) {
    return (
      <div className="flex flex-col min-h-full bg-gray-50">
        {header}
        <div className="flex items-center gap-2 px-4 md:px-6 py-2 border-b bg-white text-sm">
          <Button variant="ghost" size="sm" className="-ml-2 gap-1 text-muted-foreground" onClick={() => setLocation(SETTINGS_PATHS.root)} data-testid="button-back-to-settings">
            <ArrowLeft className="w-4 h-4" /> Settings
          </Button>
          <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
          <span className="text-gray-500">{match.group.label}</span>
          <ChevronRight className="w-3.5 h-3.5 text-gray-300" />
          <span className="font-medium text-gray-900">{match.item.subgroup ? `${match.item.subgroup} ${match.item.label.toLowerCase()}` : match.item.label}</span>
        </div>
        <SettingsErrorBoundary resetKey={match.item.key}>{match.item.render()}</SettingsErrorBoundary>
      </div>
    );
  }

  let body: ReactNode;
  if (groups.length === 0) {
    body = <p className="text-sm text-muted-foreground">There are no settings to show for this login.</p>;
  } else if (isOverview) {
    body = (
      <>
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
          <p className="text-sm text-muted-foreground mt-1">Account, channels, integrations and privacy — all in one place.</p>
        </div>
        <Overview groups={groups} onNavigate={setLocation} />
      </>
    );
  } else if (!match || !match.item.render) {
    body = (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <p className="font-medium text-gray-900">This setting isn't available for your account</p>
          <p className="text-sm text-muted-foreground">It may belong to a channel or feature that isn't turned on.</p>
          <Button variant="outline" size="sm" asChild>
            <Link href={SETTINGS_PATHS.root}>Back to all settings</Link>
          </Button>
        </CardContent>
      </Card>
    );
  } else {
    const { group, item } = match;
    body = (
      <>
        <div className="mb-6">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            {group.label}
            {item.subgroup && (<><ChevronRight className="w-3 h-3" />{item.subgroup}</>)}
          </p>
          <h2 className="text-2xl font-bold text-gray-900 mt-0.5" data-testid="settings-page-title">{item.label}</h2>
          <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
        </div>
        <SettingsErrorBoundary resetKey={item.key}>{item.render!()}</SettingsErrorBoundary>
      </>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-gray-50">
      {header}
      <div className="flex flex-1 items-stretch">
        {groups.length > 0 && (
          <aside className="hidden md:block w-56 shrink-0 border-r bg-white">
            <div className="sticky top-0 max-h-[100dvh] overflow-y-auto px-2 py-5">
              <button
                type="button"
                onClick={() => setLocation(SETTINGS_PATHS.root)}
                className={`w-full mb-4 rounded-md px-3 py-1.5 text-left text-[13px] ${isOverview ? "bg-purple-50 text-purple-700 font-medium" : "text-gray-600 hover:bg-gray-100"}`}
                data-testid="settings-nav-overview"
              >
                All settings
              </button>
              <NavList groups={groups} activeKey={activeKey} onNavigate={setLocation} />
            </div>
          </aside>
        )}
        <main className="flex-1 min-w-0 p-4 md:p-6 lg:p-8">
          {groups.length > 0 && <MobileNav groups={groups} activeKey={activeKey} onNavigate={setLocation} />}
          {body}
        </main>
      </div>
    </div>
  );
}
