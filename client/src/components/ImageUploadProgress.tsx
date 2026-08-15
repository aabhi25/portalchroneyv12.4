import { useState, useEffect, useRef } from "react";

export type ImageUploadStage = 'uploading' | 'reading' | 'ready';

const STAGES: { key: ImageUploadStage; label: string }[] = [
  { key: 'uploading', label: 'Uploading image...' },
  { key: 'reading', label: 'Reading image with AI...' },
  { key: 'ready', label: 'Done!' },
];

const MIN_STAGE_DWELL_MS = 800;

function CameraIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  );
}

function SparkleIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"/>
    </svg>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

interface ImageUploadProgressProps {
  stage: ImageUploadStage;
  chatColor?: string;
}

export function ImageUploadProgress({ stage, chatColor = '#9333ea' }: ImageUploadProgressProps) {
  const [displayIndex, setDisplayIndex] = useState(0);
  const [fadeIn, setFadeIn] = useState(true);
  const lastTransitionRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const targetIdx = STAGES.findIndex(s => s.key === stage);
    if (targetIdx < 0 || targetIdx <= displayIndex) return;

    const nextIdx = displayIndex + 1;
    const elapsed = Date.now() - lastTransitionRef.current;
    const remaining = MIN_STAGE_DWELL_MS - elapsed;

    const doTransition = () => {
      setFadeIn(false);
      timerRef.current = setTimeout(() => {
        setDisplayIndex(nextIdx);
        setFadeIn(true);
        lastTransitionRef.current = Date.now();
      }, 200);
    };

    if (remaining <= 0) {
      doTransition();
    } else {
      timerRef.current = setTimeout(doTransition, remaining);
    }

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [stage, displayIndex]);

  const currentStage = STAGES[displayIndex];
  const IconComp = displayIndex === 0 ? CameraIcon : displayIndex === 1 ? SparkleIcon : CheckIcon;
  const progress = ((displayIndex + 1) / STAGES.length) * 100;

  return (
    <div className="flex flex-col gap-2 py-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: `${chatColor}18`, animation: 'imgPulse 1.8s ease-in-out infinite' }}
        >
          <div style={{ animation: 'imgIconPulse 2s ease-in-out infinite' }}>
            <IconComp color={chatColor} />
          </div>
        </div>
        <div className={`flex flex-col gap-1 transition-all duration-200 ${fadeIn ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'}`}>
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {currentStage.label}
          </span>
          <div className="flex gap-1">
            {STAGES.map((s, i) => (
              <div
                key={s.key}
                className="h-1 rounded-full transition-all duration-500"
                style={{ width: '28px', backgroundColor: i <= displayIndex ? chatColor : `${chatColor}25` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="h-0.5 rounded-full overflow-hidden" style={{ backgroundColor: `${chatColor}15` }}>
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${chatColor}, ${chatColor}cc)`, animation: 'imgShimmer 1.5s ease-in-out infinite' }}
        />
      </div>

      <style>{`
        @keyframes imgPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.08); opacity: 0.85; } }
        @keyframes imgIconPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
        @keyframes imgShimmer { 0% { opacity: 0.7; } 50% { opacity: 1; } 100% { opacity: 0.7; } }
      `}</style>
    </div>
  );
}
