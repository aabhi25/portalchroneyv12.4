import { useState, useEffect, useRef } from "react";

export type ResumeUploadStage = 'uploading' | 'analyzing' | 'matching';

const STAGES: { key: ResumeUploadStage; label: string; icon: 'doc' | 'sparkle' | 'search' }[] = [
  { key: 'uploading', label: 'Uploading resume...', icon: 'doc' },
  { key: 'analyzing', label: 'AI is analyzing your resume...', icon: 'sparkle' },
  { key: 'matching', label: 'Finding matching jobs...', icon: 'search' },
];

const MIN_STAGE_DWELL_MS = 800;

function DocIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
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

function SearchIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

const ICON_MAP = { doc: DocIcon, sparkle: SparkleIcon, search: SearchIcon };

interface ResumeUploadProgressProps {
  stage: ResumeUploadStage;
  chatColor?: string;
}

export function ResumeUploadProgress({ stage, chatColor = '#9333ea' }: ResumeUploadProgressProps) {
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

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [stage, displayIndex]);

  const currentStage = STAGES[displayIndex];
  const IconComp = ICON_MAP[currentStage.icon];
  const progress = ((displayIndex + 1) / STAGES.length) * 100;

  return (
    <div className="flex flex-col gap-2 py-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: `${chatColor}18`,
            animation: 'resumePulse 1.8s ease-in-out infinite',
          }}
        >
          <div style={{ animation: 'resumeIconSpin 2.5s ease-in-out infinite' }}>
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
                style={{
                  width: '28px',
                  backgroundColor: i <= displayIndex ? chatColor : `${chatColor}25`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div
        className="h-0.5 rounded-full overflow-hidden"
        style={{ backgroundColor: `${chatColor}15` }}
      >
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${chatColor}, ${chatColor}cc)`,
            animation: 'resumeShimmer 1.5s ease-in-out infinite',
          }}
        />
      </div>

      <style>{`
        @keyframes resumePulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.85; }
        }
        @keyframes resumeIconSpin {
          0% { transform: rotate(0deg); }
          25% { transform: rotate(5deg); }
          75% { transform: rotate(-5deg); }
          100% { transform: rotate(0deg); }
        }
        @keyframes resumeShimmer {
          0% { opacity: 0.7; }
          50% { opacity: 1; }
          100% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
