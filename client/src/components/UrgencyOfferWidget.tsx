import { useState, useEffect, useCallback } from "react";
import { X, Gift, Clock, Phone, Check, Sparkles } from "lucide-react";

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

interface UrgencyOfferWidgetProps {
  settings: UrgencyOfferSettings;
  offerId: string;
  startedAt: string;
  onRedeem: (phoneNumber: string) => Promise<void>;
  onDismiss: () => void;
  onAcknowledgeRedemption: () => void;
  accentColor?: string;
}

export function UrgencyOfferWidget({
  settings,
  offerId,
  startedAt,
  onRedeem,
  onDismiss,
  onAcknowledgeRedemption,
  accentColor = "#8B5CF6",
}: UrgencyOfferWidgetProps) {
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isExpired, setIsExpired] = useState(false);
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedeemed, setIsRedeemed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const countdownMinutes = settings?.countdownDurationMinutes ?? 5;
  const hasValidSettings = !!(settings && settings.discountType && settings.discountValue !== undefined && startedAt);

  useEffect(() => {
    if (hasValidSettings) {
      const timer = setTimeout(() => setIsVisible(true), 100);
      return () => clearTimeout(timer);
    }
  }, [hasValidSettings]);

  const calculateTimeLeft = useCallback(() => {
    if (!startedAt || !hasValidSettings) return -1;
    const startTime = new Date(startedAt).getTime();
    const endTime = startTime + countdownMinutes * 60 * 1000;
    const now = Date.now();
    const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
    return remaining;
  }, [startedAt, countdownMinutes, hasValidSettings]);

  useEffect(() => {
    if (!hasValidSettings) return;
    const updateTimer = () => {
      const remaining = calculateTimeLeft();
      if (remaining >= 0) {
        setTimeLeft(remaining);
        setIsExpired(remaining <= 0);
      }
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [calculateTimeLeft, hasValidSettings]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const getDiscountText = () => {
    if (settings.discountType === "percentage") {
      return `${settings.discountValue}%`;
    }
    return `₹${settings.discountValue}`;
  };

  const handleClaimClick = () => {
    if (settings.requirePhone) {
      setShowPhoneInput(true);
    } else {
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (settings.requirePhone && !phoneNumber.trim()) {
      setError("Please enter your phone number");
      return;
    }
    const digitsOnly = phoneNumber.replace(/\D/g, '');
    if (settings.requirePhone && digitsOnly.length !== 10) {
      setError("Please enter a valid 10-digit mobile number");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await onRedeem(phoneNumber);
      setIsRedeemed(true);
    } catch (err: any) {
      setError(err.message || "Failed to redeem offer");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => {
      setIsDismissed(true);
      onDismiss();
    }, 300);
  };

  const handleCloseSuccessScreen = () => {
    setIsVisible(false);
    setTimeout(() => {
      setIsDismissed(true);
      onAcknowledgeRedemption();
    }, 300);
  };

  if (!hasValidSettings || isExpired || isDismissed) return null;

  const progressPercent = (timeLeft / (countdownMinutes * 60)) * 100;
  const isUrgent = timeLeft < 120;

  if (isRedeemed) {
    return (
      <div
        className="fixed z-[9999] transition-all duration-500 ease-out
          bottom-4 left-4 right-4
          sm:right-auto sm:max-w-[340px] sm:left-4 sm:bottom-4"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'translateX(0) scale(1)' : 'translateX(-20px) scale(0.95)',
        }}
      >
        <div className="rounded-2xl overflow-hidden shadow-2xl border border-green-200/50"
          style={{ backdropFilter: 'blur(20px)', background: 'rgba(255,255,255,0.97)' }}
        >
          <div className="h-1.5 bg-gradient-to-r from-green-400 to-emerald-500 w-full" />
          <div className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-green-500/20">
                <Check className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900 text-[15px]">Offer Claimed!</h3>
                <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">{settings.successMessage}</p>
              </div>
            </div>
            <button
              onClick={handleCloseSuccessScreen}
              className="w-full mt-1 py-2.5 rounded-xl text-sm font-semibold text-green-700 bg-green-50 hover:bg-green-100 transition-colors"
            >
              Continue Chatting
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed z-[9999] transition-all duration-500 ease-out
        bottom-4 left-4 right-4
        sm:right-auto sm:max-w-[340px] sm:left-4 sm:bottom-4"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateX(0) scale(1)' : 'translateX(-20px) scale(0.95)',
      }}
    >
      <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/20"
        style={{ backdropFilter: 'blur(20px)', background: 'rgba(255,255,255,0.97)' }}
      >
        <div className="relative h-1.5 bg-gray-100 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 transition-all duration-1000 rounded-full"
            style={{
              width: `${progressPercent}%`,
              background: `linear-gradient(90deg, ${accentColor}, ${accentColor}cc)`,
            }}
          />
        </div>

        <div className="p-4 sm:p-5">
          <button
            onClick={handleDismiss}
            className="absolute top-3 right-3 w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors group"
            aria-label="Dismiss offer"
          >
            <X className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600" />
          </button>

          <div className="flex items-start gap-3 mb-3 pr-6">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center shadow-lg shrink-0"
              style={{
                background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)`,
                boxShadow: `0 8px 20px ${accentColor}30`,
              }}
            >
              <Gift className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 text-[15px] leading-tight">{settings.headline}</h3>
              <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">{settings.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 mb-4">
            {settings.discountValue > 0 && (
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                style={{ background: `${accentColor}12`, color: accentColor }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="text-sm font-bold">{getDiscountText()} OFF</span>
              </div>
            )}
            <div className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${isUrgent ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-600'}`}>
              <Clock className={`w-3 h-3 ${isUrgent ? 'animate-pulse' : ''}`} />
              <span className="font-mono">{formatTime(timeLeft)}</span>
            </div>
          </div>

          {showPhoneInput ? (
            <div className="space-y-2.5">
              <label className="text-xs font-medium text-gray-600">
                {settings.phoneInputLabel}
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="tel"
                  placeholder={settings.phoneInputPlaceholder || "Mobile Number"}
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                  style={{ focusRingColor: accentColor } as any}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
              </div>
              {error && <p className="text-red-500 text-xs">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowPhoneInput(false); setError(null); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 hover:shadow-lg"
                  style={{
                    background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)`,
                    boxShadow: `0 4px 14px ${accentColor}40`,
                  }}
                >
                  {isSubmitting ? "Claiming..." : "Claim Now"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleDismiss}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                {settings.dismissButtonText || "Maybe later"}
              </button>
              <button
                onClick={handleClaimClick}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:shadow-lg active:scale-[0.98]"
                style={{
                  background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)`,
                  boxShadow: `0 4px 14px ${accentColor}40`,
                }}
              >
                {settings.ctaButtonText || "Unlock Offer"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
