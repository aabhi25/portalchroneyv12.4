import { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';

interface ConversationStartersProps {
  starters: string[];
  onSelect: (question: string) => void;
  chatColor: string;
  chatColorEnd: string;
  show: boolean;
}

export function ConversationStarters({ starters, onSelect, chatColor, chatColorEnd, show }: ConversationStartersProps) {
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    setVisible(show);
  }, [show]);

  if (!visible || !starters || starters.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 animate-fade-in">
      {/* Grid of suggestion cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {starters.map((starter, index) => (
          <button
            key={index}
            onClick={() => {
              onSelect(starter);
              setVisible(false);
            }}
            className="group relative text-left p-2.5 rounded-lg bg-white border border-gray-200/80 shadow-sm hover:shadow-lg hover:border-gray-300/80 transition-all duration-300 transform hover:-translate-y-0.5 active:scale-[0.98]"
            style={{
              animationDelay: `${index * 80}ms`
            }}
          >
            {/* Gradient accent bar */}
            <div 
              className="absolute top-0 left-0 w-1 h-full rounded-l-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              style={{
                background: `linear-gradient(to bottom, ${chatColor}, ${chatColorEnd})`
              }}
            />
            
            <div className="flex items-start gap-2 pl-0.5">
              {/* Icon */}
              <div 
                className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center mt-0.5 group-hover:scale-110 transition-transform duration-300"
                style={{
                  background: `linear-gradient(135deg, ${chatColor}15, ${chatColorEnd}15)`
                }}
              >
                <MessageSquare 
                  className="w-3 h-3 transition-colors duration-300"
                  style={{
                    color: chatColor
                  }}
                />
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 leading-snug group-hover:text-gray-900 transition-colors duration-200">
                  {starter}
                </p>
              </div>

              {/* Arrow indicator */}
              <svg 
                className="flex-shrink-0 w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all duration-300 mt-1" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
