import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { VoiceMode } from "@/components/VoiceMode";

interface WidgetSettings {
  chatColor: string;
  chatColorEnd: string;
  widgetHeaderText: string;
  avatarType?: string;
  avatarUrl?: string;
  voiceModeStyle?: string;
}

export default function VoiceEmbed() {
  const [businessAccountId, setBusinessAccountId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [isVoiceOpen, setIsVoiceOpen] = useState(true);
  const widgetUserIdRef = useRef<string>(`voice_${crypto.randomUUID()}`);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('businessAccountId');
    const campaign = urlParams.get('campaignId');
    
    if (id) setBusinessAccountId(id);
    if (campaign) setCampaignId(campaign);
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'OPEN_VOICE_EMBED') {
        setIsVoiceOpen(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const { data: settings } = useQuery<WidgetSettings>({
    queryKey: [`/api/widget-settings/public?businessAccountId=${businessAccountId}`],
    enabled: !!businessAccountId,
  });

  const handleClose = () => {
    setIsVoiceOpen(false);
    window.parent.postMessage({ type: 'CLOSE_VOICE_MODE' }, '*');
  };

  if (!businessAccountId) {
    return (
      <div className="flex items-center justify-center h-full bg-gradient-to-br from-purple-50 to-blue-50 rounded-3xl">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const chatColor = settings?.chatColor || '#9333ea';
  const chatColorEnd = settings?.chatColorEnd || '#3b82f6';

  if (!isVoiceOpen) {
    return <div className="h-full w-full bg-transparent" />;
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <VoiceMode
        isOpen={isVoiceOpen}
        onClose={handleClose}
        userId={widgetUserIdRef.current}
        businessAccountId={businessAccountId}
        widgetHeaderText={settings?.widgetHeaderText || "Voice Assistant"}
        chatColor={chatColor}
        chatColorEnd={chatColorEnd}
        voiceModeStyle={settings?.voiceModeStyle}
        avatarType={settings?.avatarType}
        avatarUrl={settings?.avatarUrl}
      />
    </div>
  );
}
