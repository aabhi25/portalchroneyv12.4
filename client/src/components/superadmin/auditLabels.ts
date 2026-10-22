/** Audit log: action codes in plain words, and a short browser name from a user-agent string. */

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.impersonation.started": "Started viewing as the account",
  "auth.impersonation.ended": "Stopped viewing as the account",
  "page.leads.viewed": "Opened the Leads page",
  "leads.export.file_generated": "Exported a leads report",
  "leads.export.file_failed": "Tried to export a leads report",
  "leads.export.data_delivered": "Leads data delivered",
  "leads.bulk_deleted": "Deleted leads in bulk",
  "user.username.changed": "Changed a username",
  "photo_search.account_key_set": "Saved the account's photo search key",
  "photo_search.account_key_removed": "Removed the account's photo search key",
  "photo_search.platform_key_set": "Saved the platform photo search key",
  "photo_search.platform_key_removed": "Removed the platform photo search key",
  "photo_search.key_tested": "Tested a photo search key",
  "avatar.business_key_set": "Saved the account's live avatar key",
  "avatar.business_key_removed": "Removed the account's live avatar key",
  "avatar.business_key_tested": "Tested the account's live avatar key",
  "avatar.platform_key_set": "Saved a platform live avatar key",
  "avatar.platform_key_removed": "Removed a platform live avatar key",
  "avatar.platform_key_tested": "Tested a platform live avatar key",
  "avatar.rates_updated": "Changed live avatar cost rates",
  "avatar.settings_updated": "Changed live avatar settings",
  "ai_calling.call_cancelled": "Cancelled an AI call",
  "ai_calling.do_not_call_added": "Added a number to do-not-call",
  "ai_calling.do_not_call_removed": "Removed a number from do-not-call",
  "ai_calling.inbound_key_rotated": "Replaced the inbound calling key",
  "ai_calling.manual_call": "Started an AI call by hand",
  "ai_calling.provider_verified": "Checked the calling provider",
  "ai_calling.settings_updated": "Changed AI calling settings",
  "ai_calling.super_admin_updated": "Changed AI calling for the account",
  "data_retention.policy_changed": "Changed auto-delete settings",
  "data_retention.override_removed": "Account now follows its group's auto-delete",
  "data_retention.purged": "Auto-delete removed old data",
  "data_retention.contacts_masked": "Hid contact details of synced leads",
};

export function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  // Unknown code: "some_area.thing_done" → "Some area: thing done".
  const [area, ...rest] = action.split(".");
  const words = (s: string) => s.replace(/_/g, " ");
  if (!rest.length) return words(area).replace(/^./, c => c.toUpperCase());
  return `${words(area).replace(/^./, c => c.toUpperCase())}: ${rest.map(words).join(" ")}`;
}

export function outcomeLabel(outcome: string): string {
  return outcome === "success" ? "Done" : outcome === "denied" ? "Denied" : outcome === "failure" ? "Failed" : outcome;
}

export function roleLabel(role: string | null): string {
  if (!role) return "";
  if (role === "super_admin") return "Super admin";
  if (role === "business_user") return "Business user";
  if (role === "account_group_admin") return "Group admin";
  return role.replace(/_/g, " ");
}

/** "Chrome on Mac", "Safari on iPhone", … from a user-agent string. */
export function browserLabel(ua: string | null): string {
  if (!ua) return "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|node|axios|python/i.test(ua) ? "Script" : "Browser";
  return os ? `${browser} on ${os}` : browser;
}
