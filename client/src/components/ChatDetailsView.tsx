import { useState } from "react";
import { ChevronLeft, Download, Phone, ExternalLink, MessageCircle, FileText } from "lucide-react";

interface DetailsTab {
  id: string;
  name: string;
  content: string;
}

interface DetailsActionButton {
  id: string;
  type: "call" | "url" | "chat" | "form";
  label: string;
  value: string;
  isPrimary: boolean;
}

interface DetailsConfig {
  brochureUrl?: string;
  brochureLabel?: string;
  tabs: DetailsTab[];
  actionButtons: DetailsActionButton[];
}

interface ChatDetailsViewProps {
  title: string;
  config: DetailsConfig;
  onBack: () => void;
  onStartChat: () => void;
  onSendMessage?: (message: string) => void;
  chatColor?: string;
  chatColorEnd?: string;
  t?: (text: string | null | undefined) => string;
}

function parseContent(content: string): JSX.Element[] {
  const lines = content.split("\n");
  const elements: JSX.Element[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    
    if (!trimmed) {
      elements.push(<div key={index} className="h-2" />);
      return;
    }

    if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
      elements.push(
        <p key={index} className="font-semibold text-gray-900 mt-3 mb-1">
          {trimmed.slice(2, -2)}
        </p>
      );
      return;
    }

    if (trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("*")) {
      const bulletContent = trimmed.slice(1).trim();
      const formattedContent = formatInlineStyles(bulletContent);
      elements.push(
        <div key={index} className="flex gap-2 ml-1 my-1">
          <span className="text-gray-400">•</span>
          <span className="text-gray-700 text-sm">{formattedContent}</span>
        </div>
      );
      return;
    }

    if (trimmed.includes(":") && !trimmed.startsWith("http")) {
      const [label, ...rest] = trimmed.split(":");
      const value = rest.join(":").trim();
      if (label.length < 30 && value) {
        elements.push(
          <p key={index} className="text-sm my-1">
            <span className="text-primary font-medium">{label}:</span>{" "}
            <span className="text-primary font-semibold">{value}</span>
          </p>
        );
        return;
      }
    }

    elements.push(
      <p key={index} className="text-gray-700 text-sm my-1">
        {formatInlineStyles(trimmed)}
      </p>
    );
  });

  return elements;
}

function formatInlineStyles(text: string): React.ReactNode {
  const boldPattern = /\*\*(.+?)\*\*/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = boldPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<strong key={match.index}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

export function ChatDetailsView({
  title,
  config,
  onBack,
  onStartChat,
  onSendMessage,
  chatColor = "#8B5CF6",
  chatColorEnd,
  t: translate,
}: ChatDetailsViewProps) {
  const [activeTabId, setActiveTabId] = useState<string | null>(
    config.tabs.length > 0 ? config.tabs[0].id : null
  );
  
  // Helper function with fallback
  const t = (text: string | null | undefined): string => {
    if (!text) return "";
    return translate ? translate(text) : text;
  };

  const activeTab = config.tabs.find((tab) => tab.id === activeTabId);

  const handleActionButton = (btn: DetailsActionButton) => {
    switch (btn.type) {
      case "call":
        window.open(`tel:${btn.value}`, "_self");
        break;
      case "url":
        const url = btn.value.startsWith("http") ? btn.value : `https://${btn.value}`;
        window.open(url, "_blank");
        break;
      case "chat":
        onStartChat();
        break;
      case "form":
        if (btn.value && onSendMessage) {
          onSendMessage(`Start form: ${btn.value}`);
        } else {
          onStartChat();
        }
        break;
    }
  };

  const getButtonIcon = (type: string) => {
    switch (type) {
      case "call":
        return <Phone className="w-4 h-4" />;
      case "url":
        return <ExternalLink className="w-4 h-4" />;
      case "chat":
        return <MessageCircle className="w-4 h-4" />;
      case "form":
        return <FileText className="w-4 h-4" />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header with back button */}
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <button
          onClick={onBack}
          className="p-1 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Title and Brochure Link */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-lg font-bold text-gray-900">{t(title)}</h2>
          {config.brochureUrl && (
            <a
              href={config.brochureUrl.startsWith("http") ? config.brochureUrl : `https://${config.brochureUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-primary text-sm hover:underline whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              {t(config.brochureLabel) || "Download"}
            </a>
          )}
        </div>

        {/* Tabs */}
        {config.tabs.length > 0 && (
          <>
            <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
              {config.tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${
                    activeTabId === tab.id
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {t(tab.name)}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            {activeTab && (
              <div className="bg-white">
                {parseContent(t(activeTab.content))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Action Buttons */}
      {config.actionButtons.length > 0 && (
        <div className="px-4 py-3 border-t bg-white">
          <div className="flex gap-2 justify-center">
            {config.actionButtons.map((btn) => (
              <button
                key={btn.id}
                onClick={() => handleActionButton(btn)}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  btn.isPrimary
                    ? "text-white"
                    : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
                style={
                  btn.isPrimary
                    ? {
                        background: chatColorEnd
                          ? `linear-gradient(135deg, ${chatColor}, ${chatColorEnd})`
                          : chatColor,
                      }
                    : undefined
                }
              >
                {getButtonIcon(btn.type)}
                {t(btn.label)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function parseDetailsConfig(actionValue: string | null | undefined): DetailsConfig | null {
  if (!actionValue) return null;
  try {
    const config = JSON.parse(actionValue);
    if (config && typeof config === 'object') {
      return {
        brochureUrl: config.brochureUrl || undefined,
        brochureLabel: config.brochureLabel || undefined,
        tabs: Array.isArray(config.tabs) ? config.tabs : [],
        actionButtons: Array.isArray(config.actionButtons) ? config.actionButtons : [],
      };
    }
    return null;
  } catch {
    return null;
  }
}
