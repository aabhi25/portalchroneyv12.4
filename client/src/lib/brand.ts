import { useSyncExternalStore } from "react";
import { PLATFORM_BRAND, type PublicBrand } from "@shared/agency";

/**
 * The brand the portal shows: ours, or an agency's (on the agency's own web address, and for
 * agency logins and agency clients wherever they log in). Set from /api/brand before login and
 * from /api/auth/me after. Pages read it with useBrand(); plain strings use brandName()/brandShort().
 */
let current: PublicBrand = PLATFORM_BRAND;
const listeners = new Set<() => void>();

export function setBrand(next: PublicBrand | null | undefined): void {
  const b = next ?? PLATFORM_BRAND;
  if (JSON.stringify(b) === JSON.stringify(current)) return;
  current = b;
  applyToDocument(b);
  listeners.forEach(l => l());
}

export function getBrand(): PublicBrand {
  return current;
}

export function useBrand(): PublicBrand {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => current,
    () => current,
  );
}

/** "AI Chroney", or the agency's brand name. */
export function brandName(): string {
  return current.name;
}

/** "Chroney" (as in "Train Chroney"), or the agency's brand name. */
export function brandShort(): string {
  return current.shortName;
}

/** Tab title, icon and the --brand colour. Our own pages keep index.html as it is. */
function applyToDocument(b: PublicBrand): void {
  if (typeof document === "undefined") return;
  if (b.isAgency) {
    document.title = b.name;
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(l => {
      if (b.logoUrl) l.href = b.logoUrl;
      else l.remove();
    });
    if (b.logoUrl && !document.querySelector('link[rel="icon"]')) {
      const link = document.createElement("link");
      link.rel = "icon";
      link.href = b.logoUrl;
      document.head.appendChild(link);
    }
  }
  if (b.primaryColor) document.documentElement.style.setProperty("--brand", b.primaryColor);
  else document.documentElement.style.removeProperty("--brand");
}

/** Mark shown where an agency has no logo: its initial on the brand colour. */
export function brandInitial(b: PublicBrand): string {
  return (b.name.trim()[0] || "•").toUpperCase();
}
