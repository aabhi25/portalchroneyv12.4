import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { SETTINGS_PATHS } from "@/pages/settings/settingsPaths";
import { SOCIAL_CHANNELS, type SocialChannel } from "./channelConfig";

/**
 * Red strip shown on the channel's inbox when Meta stopped accepting the stored access token
 * (expired / revoked): DMs are still saved, but nothing can be sent until the business
 * pastes a new token. Shares the settings query with ChannelSettings.
 */
export default function ChannelDisconnectedBanner({ channel }: { channel: SocialChannel }) {
  const c = SOCIAL_CHANNELS[channel];
  const settingsUrl = `${c.apiBase}/settings`;
  const { data: settings } = useQuery<{ tokenInvalidAt?: string | null }>({
    queryKey: [settingsUrl],
    queryFn: async () => await apiRequest("GET", settingsUrl),
  });
  if (!settings?.tokenInvalidAt) return null;
  const since = new Date(settings.tokenInvalidAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const settingsPath = channel === "instagram" ? SETTINGS_PATHS.instagramConnection : SETTINGS_PATHS.facebookConnection;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200" data-testid="banner-channel-disconnected">
      <XCircle className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-[200px]">
        <strong>{c.label} is disconnected</strong> since {since}. New messages are saved, but the AI can't reply.
      </span>
      <Link href={settingsPath} className="font-medium underline underline-offset-2">
        Reconnect {c.label}
      </Link>
    </div>
  );
}
