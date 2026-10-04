import type { LucideIcon } from "lucide-react";
import { PhoneCall, Headset, Settings, PhoneOff } from "lucide-react";

/** The Phone calls area: one list drives the sidebar and the in-page tabs. */
export interface CallingNavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  testId: string;
  matches: (location: string) => boolean;
}

export const CALLING_ROOT = "/admin/calling";

export const CALLING_NAV_ITEMS: CallingNavItem[] = [
  {
    key: "calls",
    label: "Calls",
    href: CALLING_ROOT,
    icon: PhoneCall,
    testId: "link-calling-calls",
    matches: l => l === CALLING_ROOT || l.startsWith(`${CALLING_ROOT}/calls`),
  },
  {
    key: "try",
    label: "Try a call",
    href: `${CALLING_ROOT}/try`,
    icon: Headset,
    testId: "link-calling-try",
    matches: l => l.startsWith(`${CALLING_ROOT}/try`),
  },
  {
    key: "settings",
    label: "Settings",
    href: `${CALLING_ROOT}/settings`,
    icon: Settings,
    testId: "link-calling-settings",
    matches: l => l.startsWith(`${CALLING_ROOT}/settings`),
  },
  {
    key: "dnc",
    label: "Do-not-call list",
    href: `${CALLING_ROOT}/do-not-call`,
    icon: PhoneOff,
    testId: "link-calling-dnc",
    matches: l => l.startsWith(`${CALLING_ROOT}/do-not-call`),
  },
];

export function isCallingLocation(location: string): boolean {
  return location === CALLING_ROOT || location.startsWith(`${CALLING_ROOT}/`);
}
