/**
 * Public origin used by generated widget/embed snippets.
 *
 * Each deployment can set VITE_PUBLIC_WIDGET_URL explicitly. When it is not
 * set, the current app origin is the safest default: Replit staging produces
 * demo.aichroney.com snippets and AWS production produces portal.aichroney.com
 * snippets without changing source code between builds.
 */
export function getPublicWidgetOrigin(): string {
  const configured = import.meta.env.VITE_PUBLIC_WIDGET_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }

  return "https://portal.aichroney.com";
}

export function getPublicDeploymentName(): "staging" | "production" {
  const configured = import.meta.env.VITE_DEPLOYMENT_ENV?.trim().toLowerCase();
  if (configured === "staging" || configured === "production") {
    return configured;
  }

  return getPublicWidgetOrigin() === "https://demo.aichroney.com"
    ? "staging"
    : "production";
}