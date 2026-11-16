import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/lib/brand";
import { BrandMark } from "@/components/BrandMark";
import { Mail, Lock, Shield, Zap, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Login({ onLogin }: { onLogin: (user: any) => void }) {
  const brand = useBrand();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState("");
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const parseErrorMessage = (error: any): string => {
    let message = error.message || "Something went wrong";
    
    try {
      const jsonMatch = message.match(/\{.*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.error) {
          message = parsed.error;
        }
      }
    } catch {
    }
    
    message = message.replace(/^\d+:\s*/, '');
    
    if (message.toLowerCase().includes('invalid credentials') || 
        message.toLowerCase().includes('invalid password') ||
        message.toLowerCase().includes('user not found')) {
      return "The email/username or password you entered is incorrect. Please try again.";
    }
    
    if (message.toLowerCase().includes('account') && message.toLowerCase().includes('disabled')) {
      return "Your account has been disabled. Please contact support.";
    }
    
    return message;
  };

  const loginMutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      return await apiRequest("POST", "/api/auth/login", credentials);
    },
    onSuccess: (user) => {
      setLoginError(null);
      onLogin(user);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      
      if (user.role === "super_admin") {
        setLocation("/super-admin");
      } else {
        setLocation("/");
      }
    },
    onError: (error: any) => {
      const friendlyMessage = parseErrorMessage(error);
      setLoginError(friendlyMessage);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (username && password) {
      loginMutation.mutate({ username, password });
    }
  };

  const forgotPasswordMutation = useMutation({
    mutationFn: async (email: string) => {
      return await apiRequest("POST", "/api/auth/forgot-password", { email });
    },
    onSuccess: (data) => {
      toast({
        title: "Email Sent",
        description: data.message || "If an account exists with this email, a password reset link has been sent",
      });
      setIsForgotPasswordOpen(false);
      setForgotPasswordEmail("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send reset email. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleForgotPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotPasswordEmail) {
      forgotPasswordMutation.mutate(forgotPasswordEmail);
    }
  };

  // Agencies get a neutral focus ring and their own button colour; ours keeps the purple accent.
  const inputClass = `h-12 pl-11 rounded-xl bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 shadow-sm transition-all focus-visible:ring-4 focus-visible:ring-offset-0 ${
    brand.primaryColor
      ? "focus-visible:border-slate-400 focus-visible:ring-slate-200"
      : "focus-visible:border-purple-400 focus-visible:ring-purple-500/15"
  }`;

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[#fbfbfd] text-slate-900">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden">
        <div
          className="absolute left-1/2 -top-64 h-[520px] w-[900px] -translate-x-1/2"
          style={{
            background: brand.primaryColor
              ? `radial-gradient(closest-side, color-mix(in srgb, ${brand.primaryColor} 12%, transparent), transparent)`
              : "radial-gradient(closest-side, rgba(168,85,247,.14), rgba(236,72,153,.06), transparent)",
          }}
        />
      </div>

      <div className="relative min-h-full flex flex-col items-center justify-center px-4 py-10">
        <div className="flex items-center gap-3 mb-7">
          {brand.isAgency ? (
            <BrandMark className="w-11 h-11" />
          ) : (
            <div className="w-11 h-11 flex items-center justify-center overflow-hidden">
              <img src="/c_logo.png" className="w-full h-full object-contain scale-[2.6]" alt="AI Chroney" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight text-slate-900" data-testid="login-brand-name">
              {brand.name}
            </h2>
            {brand.tagline && <p className="text-sm text-slate-500">{brand.tagline}</p>}
          </div>
        </div>

        <div className="w-full max-w-[400px] rounded-2xl border border-slate-100 bg-white p-6 sm:p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-12px_rgba(15,23,42,0.12)]">
          <div className="mb-7 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h1>
            <p className="mt-1.5 text-sm text-slate-500">Sign in to your AI workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="username" className="text-sm font-semibold text-slate-700">
                Email or username
              </Label>
              <div className="relative mt-1.5">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
                <Input
                  id="username"
                  type="text"
                  placeholder="you@company.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                  autoComplete="username"
                  data-testid="input-username"
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between">
                <Label htmlFor="password" className="text-sm font-semibold text-slate-700">
                  Password
                </Label>
                <button
                  type="button"
                  onClick={() => setIsForgotPasswordOpen(true)}
                  className="text-sm font-semibold text-purple-600 hover:text-purple-700 hover:underline"
                  style={brand.primaryColor ? { color: brand.primaryColor } : undefined}
                  data-testid="button-forgot-password"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative mt-1.5">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  data-testid="input-password"
                  className={inputClass}
                />
              </div>
            </div>

            {loginError && (
              <div className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 p-3.5" role="alert">
                <AlertCircle className="w-[18px] h-[18px] text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 leading-relaxed">{loginError}</p>
              </div>
            )}

            <Button
              type="submit"
              style={brand.primaryColor ? { background: brand.primaryColor } : undefined}
              className={`w-full h-12 !mt-6 rounded-xl border-0 bg-gradient-to-r from-violet-600 to-pink-600 text-base font-semibold text-white transition-all hover:brightness-110 active:scale-[0.99] ${
                brand.primaryColor ? "shadow-md" : "shadow-[0_8px_20px_-6px_rgba(219,39,119,0.45)]"
              }`}
              disabled={loginMutation.isPending}
              data-testid="button-login"
            >
              {loginMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Signing in...
                </span>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            Encrypted & GDPR-ready
          </span>
          <span className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            Shopify, WooCommerce & more
          </span>
        </div>

        {!brand.isAgency && (
          <p className="mt-3 text-xs text-slate-400">
            Powered by <span className="font-semibold text-slate-500">KnightLabs AI</span>
          </p>
        )}
        {brand.isAgency && brand.supportEmail && (
          <p className="mt-3 text-xs text-slate-400">
            Need help? <span className="select-all font-medium text-slate-600">{brand.supportEmail}</span>
          </p>
        )}
      </div>

      <Dialog open={isForgotPasswordOpen} onOpenChange={setIsForgotPasswordOpen}>
        <DialogContent className="sm:max-w-md bg-white text-slate-900 border-slate-200">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <Mail className="w-5 h-5 text-purple-600" style={brand.primaryColor ? { color: brand.primaryColor } : undefined} />
              Reset your password
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              Enter your email address and we'll send you a link to reset your password.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleForgotPassword} className="space-y-4 mt-2">
            <div>
              <Label htmlFor="forgot-email" className="text-sm font-semibold text-slate-700">
                Email address
              </Label>
              <Input
                id="forgot-email"
                type="email"
                placeholder="you@company.com"
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                required
                className="mt-1.5 h-11 rounded-xl bg-white border-slate-200 text-slate-900 placeholder:text-slate-400"
              />
            </div>
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsForgotPasswordOpen(false);
                  setForgotPasswordEmail("");
                }}
                className="flex-1 h-11 rounded-xl bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                style={brand.primaryColor ? { background: brand.primaryColor } : undefined}
                className="flex-1 h-11 rounded-xl border-0 bg-gradient-to-r from-violet-600 to-pink-600 text-white hover:brightness-110"
                disabled={forgotPasswordMutation.isPending}
              >
                {forgotPasswordMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Sending...
                  </span>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
