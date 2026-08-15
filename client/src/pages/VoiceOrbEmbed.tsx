import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { VoiceMode, type VoiceState } from "@/components/VoiceMode";

interface WidgetSettings {
  chatColor: string;
  chatColorEnd: string;
  widgetHeaderText: string;
  avatarType?: string;
  avatarUrl?: string;
  voiceModeStyle?: string;
}

export default function VoiceOrbEmbed() {
  const [businessAccountId, setBusinessAccountId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  
  const widgetUserIdRef = useRef<string>(`voice_orb_${crypto.randomUUID()}`);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('businessAccountId');
    const campaign = urlParams.get('campaignId');
    
    if (id) setBusinessAccountId(id);
    if (campaign) setCampaignId(campaign);
  }, []);

  const { data: settings } = useQuery<WidgetSettings>({
    queryKey: [`/api/widget-settings/public?businessAccountId=${businessAccountId}`],
    enabled: !!businessAccountId,
  });

  const postStateToParent = useCallback((state: VoiceState | 'idle') => {
    window.parent.postMessage({ type: 'VOICE_STATE_CHANGE', state }, '*');
  }, []);

  const handleStateChange = useCallback((state: VoiceState) => {
    postStateToParent(state);
  }, [postStateToParent]);

  const handleClose = useCallback(() => {
    setIsVoiceActive(false);
    // VoiceMode cleanup will trigger onStateChange('idle') via its natural cleanup flow
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'TOGGLE_VOICE') {
        if (isVoiceActive) {
          // Turning off - post idle immediately for responsive UI, VoiceMode will cleanup
          setIsVoiceActive(false);
          postStateToParent('idle');
        } else {
          // Turning on - VoiceMode will post state changes as it connects
          setIsVoiceActive(true);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isVoiceActive, postStateToParent]);

  if (!businessAccountId) {
    return null;
  }

  const chatColor = settings?.chatColor || '#9333ea';
  const chatColorEnd = settings?.chatColorEnd || '#3b82f6';

  return (
    <VoiceMode
      isOpen={isVoiceActive}
      onClose={handleClose}
      userId={widgetUserIdRef.current}
      businessAccountId={businessAccountId}
      widgetHeaderText={settings?.widgetHeaderText || "Voice Assistant"}
      chatColor={chatColor}
      chatColorEnd={chatColorEnd}
      voiceModeStyle={settings?.voiceModeStyle}
      avatarType={settings?.avatarType}
      avatarUrl={settings?.avatarUrl}
      onStateChange={handleStateChange}
      headless={true}
      autoStart={true}
    />
  );
}
