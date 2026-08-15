import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Mail, Lock, Shield, Zap, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function Login({ onLogin }: { onLogin: (user: any) => void }) {
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

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[#0B0F1A] via-[#1e3a8a] to-[#7c3aed] animate-gradient-shift">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
          <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
          <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000"></div>
        </div>
      </div>

      <div className="relative w-full h-full flex items-center justify-center">
        <div className="w-full flex items-center justify-center p-4 lg:p-8">
          <div className="w-full max-w-md">
            <div className="relative bg-white/10 backdrop-blur-2xl rounded-3xl p-8 shadow-2xl border border-white/20">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-16 h-16 flex items-center justify-center overflow-hidden">
                  <img src="/c_logo.png" className="w-24 h-24 object-contain scale-150" alt="AI Chroney" style={{ mixBlendMode: 'screen' }} />
                </div>
                <h2 className="text-2xl font-bold text-white">
                  AI Chroney
                </h2>
              </div>

              <div className="mb-8">
                <h1 className="text-2xl font-bold text-white leading-tight text-center">Welcome back to your AI Workspace</h1>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <Label htmlFor="username" className="text-sm font-medium text-white/90">
                    Email / Username
                  </Label>
                  <div className="relative mt-2">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/70" />
                    <Input
                      id="username"
                      type="text"
                      placeholder="Enter your email or username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoFocus
                      data-testid="input-username"
                      className="pl-11 bg-white/20 border-white/30 text-white placeholder:text-white/60 focus:bg-white/25 focus:border-white/50 focus:ring-2 focus:ring-purple-400/50 transition-all h-12 shadow-lg"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="password" className="text-sm font-medium text-white/90">
                    Password
                  </Label>
                  <div className="relative mt-2">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/70" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      data-testid="input-password"
                      className="pl-11 bg-white/20 border-white/30 text-white placeholder:text-white/60 focus:bg-white/25 focus:border-white/50 focus:ring-2 focus:ring-purple-400/50 transition-all h-12 shadow-lg"
                    />
                  </div>
                </div>

                {loginError && (
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/20 border border-red-400/30 backdrop-blur-sm">
                    <AlertCircle className="w-5 h-5 text-red-300 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-100 leading-relaxed">{loginError}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-purple-600 via-pink-600 to-purple-700 hover:from-purple-700 hover:via-pink-700 hover:to-purple-800 text-white border-0 shadow-xl h-12 text-base font-semibold mt-6 transition-all duration-300 hover:shadow-2xl hover:shadow-purple-500/50 hover:scale-[1.02] active:scale-[0.98]"
                  disabled={loginMutation.isPending}
                  data-testid="button-login"
                >
                  {loginMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Signing in...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Sign In
                      <Sparkles className="w-4 h-4" />
                    </span>
                  )}
                </Button>
              </form>

              <div className="mt-5 text-center">
                <Dialog open={isForgotPasswordOpen} onOpenChange={setIsForgotPasswordOpen}>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      className="text-sm text-white/80 hover:text-white font-medium hover:underline transition-colors"
                    >
                      Forgot Password?
                    </button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md bg-slate-900 border-white/10">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-white">
                        <Mail className="w-5 h-5 text-purple-400" />
                        Reset Your Password
                      </DialogTitle>
                      <DialogDescription className="text-white/70">
                        Enter your email address and we'll send you a link to reset your password.
                      </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleForgotPassword} className="space-y-4 mt-4">
                      <div>
                        <Label htmlFor="forgot-email" className="text-sm font-medium text-white/90">
                          Email Address
                        </Label>
                        <Input
                          id="forgot-email"
                          type="email"
                          placeholder="Enter your email"
                          value={forgotPasswordEmail}
                          onChange={(e) => setForgotPasswordEmail(e.target.value)}
                          required
                          className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-white/40"
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
                          className="flex-1 bg-white/5 border-white/10 text-white hover:bg-white/10"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
                          disabled={forgotPasswordMutation.isPending}
                        >
                          {forgotPasswordMutation.isPending ? (
                            <span className="flex items-center gap-2">
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              Sending...
                            </span>
                          ) : (
                            "Send Reset Link"
                          )}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="mt-8 space-y-3">
                <div className="flex items-center gap-6 text-xs text-white/60">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    <span>Data encrypted & GDPR-ready</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/60">
                  <Zap className="w-4 h-4" />
                  <span>Integrated with Shopify, WooCommerce & more</span>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-white/10 text-center">
                <p className="text-xs text-white/50">
                  Powered by <span className="font-semibold text-white/70">KnightLabs AI</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
