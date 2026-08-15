import { useState, useEffect, useCallback, useRef } from "react";

interface UrgencyOfferSettings {
  countdownDurationMinutes: number;
  discountType: string;
  discountValue: number;
  headline: string;
  description: string;
  ctaButtonText: string;
  dismissButtonText: string;
  successMessage: string;
  phoneInputLabel: string;
  phoneInputPlaceholder: string;
  requirePhone: boolean;
}

interface ActiveOffer {
  offerId: string;
  campaignId?: string;
  settings: UrgencyOfferSettings;
  startedAt: string;
  expiresAt: string;
}

interface UseUrgencyOfferProps {
  businessAccountId: string | undefined;
  sessionId: string;
  enabled?: boolean;
}

const STORAGE_KEY_PREFIX = "urgency_offer_";
const VISITOR_ID_KEY = "urgency_visitor_id";

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function getPersistentVisitorId(): string {
  try {
    let visitorId = localStorage.getItem(VISITOR_ID_KEY);
    if (!visitorId) {
      visitorId = generateUUID();
      localStorage.setItem(VISITOR_ID_KEY, visitorId);
    }
    return visitorId;
  } catch {
    return generateUUID();
  }
}

export function useUrgencyOffer({
  businessAccountId,
  enabled = true,
  sessionId,
}: UseUrgencyOfferProps) {
  const [activeOffer, setActiveOffer] = useState<ActiveOffer | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isRedeemed, setIsRedeemed] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const pendingMessagesRef = useRef<string[]>([]);

  const visitorId = getPersistentVisitorId();
  const storageKey = `${STORAGE_KEY_PREFIX}${businessAccountId}_${visitorId}`;
  const campaignStateKey = `${storageKey}_campaigns`;

  function getCampaignStates(): Record<string, { redeemed?: number; dismissed?: number }> {
    try {
      const raw = localStorage.getItem(campaignStateKey);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch { return {}; }
  }

  function setCampaignState(campaignId: string, state: { redeemed?: number; dismissed?: number }) {
    const states = getCampaignStates();
    states[campaignId] = state;
    localStorage.setItem(campaignStateKey, JSON.stringify(states));
  }

  useEffect(() => {
    if (!businessAccountId || !visitorId || isInitialized) return;

    const initializeOffer = async () => {
      try {
        const response = await fetch(
          `/api/urgency-offer/active?businessAccountId=${encodeURIComponent(businessAccountId)}&visitorToken=${encodeURIComponent(visitorId)}`
        );

        if (response.ok) {
          const serverOffer = await response.json();
          
          if (serverOffer.hasActiveOffer && serverOffer.status === 'active') {
            const expiresAt = new Date(serverOffer.expiresAt).getTime();
            
            if (expiresAt > Date.now()) {
              const validatedOffer: ActiveOffer = {
                offerId: serverOffer.offerId,
                campaignId: serverOffer.campaignId,
                settings: serverOffer.settings,
                startedAt: serverOffer.startedAt,
                expiresAt: serverOffer.expiresAt,
              };
              setActiveOffer(validatedOffer);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching active offer:", error);
      }
      
      const pendingKey = `${storageKey}_pending`;
      const pendingData = localStorage.getItem(pendingKey);
      if (pendingData && !activeOffer) {
        try {
          const pending = JSON.parse(pendingData);
          if (pending.offerId && pending.expiresAt) {
            const expiresAt = new Date(pending.expiresAt).getTime();
            if (expiresAt > Date.now()) {
              const settingsResponse = await fetch(`/api/urgency-offer/settings/public?businessAccountId=${businessAccountId}`);
              if (settingsResponse.ok) {
                const settingsData = await settingsResponse.json();
                const newOffer: ActiveOffer = {
                  offerId: pending.offerId,
                  campaignId: pending.campaignId,
                  settings: settingsData,
                  startedAt: pending.startedAt,
                  expiresAt: pending.expiresAt,
                };
                setActiveOffer(newOffer);
                localStorage.removeItem(pendingKey);
              }
            } else {
              localStorage.removeItem(pendingKey);
            }
          }
        } catch (e) {
          localStorage.removeItem(pendingKey);
        }
      }
      
      setIsInitialized(true);
    };

    initializeOffer();
  }, [businessAccountId, visitorId, storageKey, isInitialized, activeOffer]);

  // Check a single message for purchase intent
  const checkMessageIntent = useCallback(async (message: string, conversationId?: string) => {
    // Don't check if we already have an offer, redeemed, or dismissed
    if (activeOffer || isDismissed || isRedeemed) return;
    if (!businessAccountId || !enabled) return;
    
    // If not initialized yet, queue for later
    if (!isInitialized) {
      pendingMessagesRef.current.push(message);
      return;
    }

    const fetchAndDisplayOffer = async (offerData: { offerId: string; campaignId?: string; startedAt: string; expiresAt: string }, retriesLeft: number): Promise<void> => {
      try {
        const campaignParam = offerData.campaignId ? `&campaignId=${encodeURIComponent(offerData.campaignId)}` : '';
        const settingsResponse = await fetch(`/api/urgency-offer/settings/public?businessAccountId=${businessAccountId}${campaignParam}`);
        
        if (settingsResponse.ok) {
          const settingsData = await settingsResponse.json();
          const newOffer: ActiveOffer = {
            offerId: offerData.offerId,
            campaignId: offerData.campaignId,
            settings: settingsData,
            startedAt: offerData.startedAt,
            expiresAt: offerData.expiresAt,
          };
          setActiveOffer(newOffer);
          localStorage.setItem(storageKey, JSON.stringify(newOffer));
          localStorage.removeItem(`${storageKey}_pending`);
        } else if (retriesLeft > 0) {
          setTimeout(() => fetchAndDisplayOffer(offerData, retriesLeft - 1), 2000);
        }
      } catch (error) {
        console.error("Error fetching offer settings:", error);
        if (retriesLeft > 0) {
          setTimeout(() => fetchAndDisplayOffer(offerData, retriesLeft - 1), 2000);
        }
      }
    };

    // Check intent with retries
    const checkIntent = async (retriesLeft: number): Promise<void> => {
      try {
        const response = await fetch("/api/urgency-offer/check-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessAccountId,
            visitorToken: visitorId,
            conversationId: conversationId || undefined,
            conversationHistory: [{ role: "user", content: message }],
          }),
        });

        if (!response.ok) {
          if (retriesLeft > 0) {
            setTimeout(() => checkIntent(retriesLeft - 1), 2000);
          }
          return;
        }

        const data = await response.json();
        
        if (data.shouldShowOffer && data.offerId && data.startedAt && data.expiresAt) {
          const pendingOffer = {
            offerId: data.offerId,
            campaignId: data.campaignId,
            startedAt: data.startedAt,
            expiresAt: data.expiresAt,
            settingsPending: true
          };
          localStorage.setItem(`${storageKey}_pending`, JSON.stringify(pendingOffer));
          
          fetchAndDisplayOffer(
            { offerId: data.offerId, campaignId: data.campaignId, startedAt: data.startedAt, expiresAt: data.expiresAt },
            5
          );
        }
      } catch (error) {
        console.error("Error checking urgency offer:", error);
        if (retriesLeft > 0) {
          setTimeout(() => checkIntent(retriesLeft - 1), 2000);
        }
      }
    };

    checkIntent(2); // Up to 2 retries for intent check
  }, [businessAccountId, enabled, activeOffer, isDismissed, isRedeemed, isInitialized, visitorId, storageKey]);

  // Process pending messages after initialization
  useEffect(() => {
    if (isInitialized && pendingMessagesRef.current.length > 0 && !activeOffer && !isDismissed && !isRedeemed) {
      const messages = [...pendingMessagesRef.current];
      pendingMessagesRef.current = [];
      // Check all pending messages
      messages.forEach(msg => checkMessageIntent(msg));
    }
  }, [isInitialized, activeOffer, isDismissed, isRedeemed, checkMessageIntent]);

  const redeemOffer = useCallback(async (phoneNumber: string, conversationId?: string) => {
    if (!activeOffer) throw new Error("No active offer");

    const response = await fetch("/api/urgency-offer/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offerId: activeOffer.offerId,
        phoneNumber,
        conversationId: conversationId || undefined,
        pageUrl: window.location.href,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to redeem offer");
    }

    const data = await response.json();
    setIsRedeemed(true);
    const now = new Date().toISOString();
    localStorage.setItem(
      storageKey,
      JSON.stringify({ isRedeemed: true, redeemedAt: now })
    );
    if (activeOffer.campaignId) setCampaignState(activeOffer.campaignId, { redeemed: Date.now() });
    return data;
  }, [activeOffer, storageKey]);

  const dismissOffer = useCallback(async () => {
    if (!activeOffer) return;

    try {
      await fetch("/api/urgency-offer/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId: activeOffer.offerId,
        }),
      });
    } catch (error) {
      console.error("Error dismissing offer:", error);
    }

    setIsDismissed(true);
    const now = new Date().toISOString();
    localStorage.setItem(
      storageKey,
      JSON.stringify({ isDismissed: true, dismissedAt: now })
    );
    if (activeOffer.campaignId) setCampaignState(activeOffer.campaignId, { dismissed: Date.now() });
  }, [activeOffer, storageKey]);

  const clearOffer = useCallback(() => {
    setActiveOffer(null);
    setIsDismissed(false);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  const acknowledgeRedemption = useCallback(() => {
    setActiveOffer(null);
    setIsRedeemed(true);
    const now = new Date().toISOString();
    localStorage.setItem(storageKey, JSON.stringify({ isRedeemed: true, redeemedAt: now }));
  }, [storageKey]);

  return {
    activeOffer,
    isDismissed,
    isRedeemed,
    redeemOffer,
    dismissOffer,
    clearOffer,
    acknowledgeRedemption,
    checkMessageIntent,
  };
}
