import type { MeResponseDto } from "@shared/dto";
import Settings from "@/pages/Settings";
import WidgetSettings, { type WidgetSettingsTab } from "@/pages/WidgetSettings";
import TrainChroney from "@/pages/TrainChroney";
import OtpSettings from "@/pages/OtpSettings";
import CategorySettings from "@/pages/CategorySettings";
import WhatsApp from "@/pages/WhatsApp";
import WhatsAppAISetup from "@/pages/WhatsAppAISetup";
import InstagramSettings from "@/pages/InstagramSettings";
import InstagramLeads from "@/pages/InstagramLeads";
import InstagramCommentSettings from "@/pages/InstagramCommentSettings";
import FacebookSettings from "@/pages/FacebookSettings";
import FacebookCommentSettings from "@/pages/FacebookCommentSettings";
import VisualSearchSettings from "@/pages/VisualSearchSettings";
import DataRetentionSettings from "@/pages/settings/DataRetentionSettings";
import type { HubAreaId } from "@/navigation/hubAreas";

const widget = (tab: WidgetSettingsTab) => () => <WidgetSettings initialTab={tab} />;

/**
 * The screen each in-area settings item shows (items with an `href` in hubAreas.ts open their
 * own page instead). These are the same screens the old Settings hub embedded.
 */
const SCREENS: Partial<Record<`${HubAreaId}/${string}`, (user: MeResponseDto | null) => JSX.Element>> = {
  "leads/export": () => <Settings section="lead-privacy" embedded />,
  "leads/auto-delete": (user) => <DataRetentionSettings user={user} />,

  "website/appearance": widget("appearance"),
  "website/avatar": widget("avatar"),
  "website/voice": widget("voice"),
  "website/behaviour": widget("behavior"),
  "website/shopping": widget("shopping"),
  "website/nudges": widget("nudges"),
  "website/install": widget("embed"),
  "website/lead-capture": () => <TrainChroney only="lead-training" />,
  "website/verification": () => <OtpSettings embedded />,
  "website/categories": () => <CategorySettings embedded />,

  "whatsapp/connection": () => <WhatsApp embeddedPage="config" />,
  "whatsapp/ai-replies": () => <WhatsAppAISetup />,
  "whatsapp/lead-capture": () => <WhatsApp embeddedPage="lead-capture-settings" />,

  "instagram/connection": () => <InstagramSettings embedded />,
  "instagram/comments": () => <InstagramCommentSettings embedded />,
  "instagram/lead-capture": () => <InstagramLeads embeddedPage="lead-capture-settings" />,

  "facebook/connection": () => <FacebookSettings embedded />,
  "facebook/comments": () => <FacebookCommentSettings embedded />,

  "vista/look": () => <Settings section="vista-look" embedded />,
  "vista/visual-search": () => <VisualSearchSettings embedded />,
};

export function hubSettingsScreen(area: HubAreaId, key: string): ((user: MeResponseDto | null) => JSX.Element) | undefined {
  return SCREENS[`${area}/${key}`];
}
