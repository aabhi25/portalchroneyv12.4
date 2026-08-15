import { useState, useEffect } from "react";
import { Link2, Copy, RotateCw, Check, Lock, LockOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ShareLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  publicLink: {
    id: string;
    businessAccountId: string;
    token: string;
    isActive: string;
    password: string | null;
    url: string;
    accessCount: string;
  } | undefined;
  refetchLink: () => Promise<any>;
  chatColor: string;
  chatColorEnd: string;
}

export function ShareLinkModal({
  isOpen,
  onClose,
  publicLink,
  refetchLink,
  chatColor,
  chatColorEnd,
}: ShareLinkModalProps) {
  const { toast } = useToast();
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkPassword, setLinkPassword] = useState("");
  const [isPasswordEnabled, setIsPasswordEnabled] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  useEffect(() => {
    if (publicLink) {
      setIsPasswordEnabled(!!publicLink.password);
      setLinkPassword(publicLink.password || "");
    }
  }, [publicLink]);

  const handleCopyLink = async () => {
    if (publicLink?.url) {
      try {
        await navigator.clipboard.writeText(publicLink.url);
        setLinkCopied(true);
        toast({
          title: "Link copied!",
          description: "Public chat link copied to clipboard",
        });
        setTimeout(() => setLinkCopied(false), 2000);
      } catch (error) {
        toast({
          title: "Failed to copy",
          description: "Please copy the link manually",
          variant: "destructive",
        });
      }
    }
  };

  const handleToggleLink = async () => {
    try {
      const response = await fetch('/api/public-chat-link/toggle', {
        method: 'PATCH',
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to toggle link');
      
      await refetchLink();
      toast({
        title: "Link updated",
        description: publicLink?.isActive === "true" ? "Public chat link disabled" : "Public chat link enabled",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to toggle link status",
        variant: "destructive",
      });
    }
  };

  const handleRegenerateLink = async () => {
    try {
      const response = await fetch('/api/public-chat-link/regenerate', {
        method: 'POST',
        credentials: 'include',
      });
      
      if (!response.ok) throw new Error('Failed to regenerate link');
      
      await refetchLink();
      toast({
        title: "Link regenerated",
        description: "A new public chat link has been created",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to regenerate link",
        variant: "destructive",
      });
    }
  };

  const handleUpdatePassword = async () => {
    try {
      setIsUpdatingPassword(true);
      const response = await fetch('/api/public-chat-link/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          password: isPasswordEnabled ? linkPassword : null 
        }),
      });
      
      if (!response.ok) throw new Error('Failed to update password');
      
      await refetchLink();
      toast({
        title: "Password updated",
        description: isPasswordEnabled 
          ? "Password protection enabled for public chat" 
          : "Password protection removed",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update password",
        variant: "destructive",
      });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  if (!publicLink) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div 
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
            >
              <Link2 className="w-5 h-5 text-white" />
            </div>
            Shareable Public Chat Link
          </DialogTitle>
          <DialogDescription>
            Share this link with anyone to let them chat with your AI assistant
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* URL Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">Public Chat URL</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-200 min-w-0 overflow-hidden">
                <p className="text-xs text-gray-700 font-mono break-all">
                  {publicLink.url}
                </p>
              </div>
              <Button
                onClick={handleCopyLink}
                size="sm"
                className="flex items-center gap-2 px-4 h-10 whitespace-nowrap shrink-0"
                style={{ 
                  background: linkCopied 
                    ? '#10b981' 
                    : `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` 
                }}
              >
                {linkCopied ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Toggle Section */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Switch
                checked={publicLink.isActive === "true"}
                onCheckedChange={handleToggleLink}
                id="link-toggle-modal"
              />
              <label htmlFor="link-toggle-modal" className="text-sm font-medium text-gray-700 cursor-pointer">
                {publicLink.isActive === "true" ? "Link Active" : "Link Disabled"}
              </label>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
              publicLink.isActive === "true" 
                ? 'bg-green-100 text-green-700' 
                : 'bg-gray-100 text-gray-600'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                publicLink.isActive === "true" ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
              }`}></div>
              <span className="font-medium">
                {publicLink.isActive === "true" ? "Active" : "Disabled"}
              </span>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="password-enabled-modal"
                checked={isPasswordEnabled}
                onChange={(e) => setIsPasswordEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 cursor-pointer accent-purple-600"
              />
              <label htmlFor="password-enabled-modal" className="text-sm font-medium text-gray-700 flex items-center gap-2 cursor-pointer">
                {isPasswordEnabled ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
                Password Protection
              </label>
            </div>
            {isPasswordEnabled && (
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  placeholder="Enter password..."
                  value={linkPassword}
                  onChange={(e) => setLinkPassword(e.target.value)}
                  className="flex-1 h-10"
                />
                <Button
                  onClick={handleUpdatePassword}
                  disabled={isUpdatingPassword || !linkPassword.trim()}
                  size="sm"
                  className="h-10 px-4"
                  style={{ background: `linear-gradient(to right, ${chatColor}, ${chatColorEnd})` }}
                >
                  {isUpdatingPassword ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            )}
            {!isPasswordEnabled && publicLink.password && (
              <Button
                onClick={handleUpdatePassword}
                disabled={isUpdatingPassword}
                size="sm"
                variant="outline"
                className="h-9 w-full"
              >
                Remove Password
              </Button>
            )}
            <p className="text-xs text-gray-500 leading-relaxed">
              {isPasswordEnabled ? "🔒 Visitors will need to enter this password before accessing the chat" : "🔓 Anyone with the link can access the chat without a password"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleRegenerateLink}
              variant="outline"
              className="flex items-center gap-2 flex-1"
            >
              <RotateCw className="w-4 h-4" />
              Regenerate Link
            </Button>
          </div>

          {publicLink.isActive === "true" ? (
            <div className="text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
              💡 <strong>Tip:</strong> Anyone with this link can chat with your AI assistant without logging in. 
              Disable the link to prevent new visitors from accessing it, or regenerate to create a new URL.
            </div>
          ) : (
            <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
              ⚠️ This link is currently disabled. Enable it to allow visitors to access the public chat.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
