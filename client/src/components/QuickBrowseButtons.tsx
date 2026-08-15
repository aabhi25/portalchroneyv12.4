import { useEffect, useState } from "react";

interface QuickBrowseButton {
  label: string;
  action: string;
}

interface QuickBrowseButtonsProps {
  buttons: QuickBrowseButton[];
  onSelect: (action: string) => void;
  chatColor?: string;
  chatColorEnd?: string;
  collapsible?: boolean;
  collapsedCount?: number;
}

const NEUTRAL_BORDER = "#d1d5db";
const NEUTRAL_BORDER_HOVER = "#9ca3af";
const NEUTRAL_TEXT = "#374151";
const NEUTRAL_BG_HOVER = "#f9fafb";

export function QuickBrowseButtons({ 
  buttons, 
  onSelect,
  chatColor = "#9333ea",
  chatColorEnd = "#3b82f6",
  collapsible = false,
  collapsedCount = 2
}: QuickBrowseButtonsProps) {
  const [showModal, setShowModal] = useState(false);
  const safeCollapsedCount = Math.max(1, collapsedCount);

  useEffect(() => {
    setShowModal(false);
  }, [buttons, collapsible, safeCollapsedCount]);

  if (!buttons || buttons.length === 0) return null;

  const canCollapse = collapsible && buttons.length > safeCollapsedCount;
  const visibleButtons = canCollapse ? buttons.slice(0, safeCollapsedCount) : buttons;
  const hiddenCount = buttons.length - safeCollapsedCount;

  // Journey options (collapsible) use a classy neutral look; the legacy
  // product quick-browse usage keeps the brand-colored pill styling.
  const neutral = collapsible;

  const containerClass = collapsible
    ? "flex flex-col gap-2 my-3 px-1"
    : "flex flex-wrap gap-2 my-3 px-1";

  const buttonClass = collapsible
    ? "group relative w-full px-4 py-2.5 text-sm font-medium rounded-xl border text-left transition-all duration-200 active:scale-[0.98]"
    : "group relative px-3 py-1.5 text-sm font-medium rounded-full border-2 transition-all duration-200 hover:scale-105 active:scale-95";

  const baseBorder = neutral ? NEUTRAL_BORDER : chatColor;
  const baseText = neutral ? NEUTRAL_TEXT : chatColor;

  const applyHover = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (neutral) {
      e.currentTarget.style.background = NEUTRAL_BG_HOVER;
      e.currentTarget.style.color = NEUTRAL_TEXT;
      e.currentTarget.style.borderColor = NEUTRAL_BORDER_HOVER;
    } else {
      e.currentTarget.style.background = `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`;
      e.currentTarget.style.color = 'white';
      e.currentTarget.style.borderColor = 'transparent';
    }
  };
  const removeHover = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = 'transparent';
    e.currentTarget.style.color = baseText;
    e.currentTarget.style.borderColor = baseBorder;
  };

  const handleSelect = (action: string) => {
    setShowModal(false);
    onSelect(action);
  };

  return (
    <>
      <div className={containerClass}>
        {visibleButtons.map((button, index) => (
          <button
            key={index}
            onClick={() => handleSelect(button.action)}
            className={buttonClass}
            style={{ borderColor: baseBorder, color: baseText, background: 'transparent' }}
            onMouseEnter={applyHover}
            onMouseLeave={removeHover}
          >
            {button.label}
          </button>
        ))}

        {canCollapse && (
          <button
            onClick={() => setShowModal(true)}
            className="self-start text-sm font-semibold px-1 py-1 transition-opacity duration-200 hover:opacity-70"
            style={{ color: chatColor, background: 'transparent' }}
          >
            {`View More (${hiddenCount})`}
          </button>
        )}
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
          <div
            className="relative z-10 w-full max-w-sm max-h-[80%] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <span className="text-sm font-semibold text-gray-800">Select an option</span>
              <button
                onClick={() => setShowModal(false)}
                aria-label="Close"
                className="p-1 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-2 p-3 overflow-y-auto">
              {buttons.map((button, index) => (
                <button
                  key={index}
                  onClick={() => handleSelect(button.action)}
                  className="group relative w-full px-4 py-2.5 text-sm font-medium rounded-xl border text-left transition-all duration-200 active:scale-[0.98]"
                  style={{ borderColor: NEUTRAL_BORDER, color: NEUTRAL_TEXT, background: 'transparent' }}
                  onMouseEnter={applyHover}
                  onMouseLeave={removeHover}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
