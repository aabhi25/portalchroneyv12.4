import { Sparkles, PenSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatHeaderProps {
  onNewChat?: () => void;
}

export function ChatHeader({ onNewChat }: ChatHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[60px] border-b bg-gradient-to-r from-[hsl(var(--gradient-start))] to-[hsl(var(--gradient-end))]">
      <div className="flex items-center justify-between h-full px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-white" data-testid="icon-sparkles" />
          <h1 className="text-lg font-semibold text-white" data-testid="text-header-title">
            AI Chroney
          </h1>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onNewChat}
          className="text-white hover:bg-white/10 active:bg-white/20"
          data-testid="button-new-chat"
          aria-label="Start new chat"
        >
          <PenSquare className="w-5 h-5" />
        </Button>
      </div>
    </header>
  );
}
