import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Settings2, AlertCircle, Lock, Loader2, Upload, Trash2, Palette, Sparkles, Check, CheckCircle2, ArrowRight, Database, SlidersHorizontal, RefreshCw } from "lucide-react";
import type { MeResponseDto } from "@shared/dto";
import { isTopScholarSuperAdminView } from "@/lib/accountAccess";

interface WidgetSettings {
  visualSimilarityThreshold?: string;
  showcaseLogo?: string | null;
  showcaseThemeColor?: string;
  showcaseThemePreset?: string;
}

type ThemePreset = 'noir_luxe' | 'champagne_glow' | 'amethyst_aurora';

const LUXE_THEMES: Record<ThemePreset, { name: string; description: string; primary: string; secondary: string; accent: string; bg: string; text: string }> = {
  noir_luxe: {
    name: "Noir Luxe",
    description: "Sophisticated all-black elegance",
    primary: "#000000",
    secondary: "#1a1a1a",
    accent: "#d4af37",
    bg: "#0a0a0a",
    text: "#ffffff"
  },
  champagne_glow: {
    name: "Champagne Glow",
    description: "Warm golden sophistication",
    primary: "#c4a35a",
    secondary: "#8b7355",
    accent: "#f5e6c8",
    bg: "#faf8f5",
    text: "#2c2416"
  },
  amethyst_aurora: {
    name: "Amethyst Aurora",
    description: "Cool purple radiance",
    primary: "#7c3aed",
    secondary: "#a855f7",
    accent: "#e9d5ff",
    bg: "#faf5ff",
    text: "#1e1b4b"
  }
};

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showcaseThemeColor, setShowcaseThemeColor] = useState("#9333ea");
  const [showcaseThemePreset, setShowcaseThemePreset] = useState<ThemePreset>('noir_luxe');
  const logoInputRef = useRef<HTMLInputElement>(null);

  const { data: user } = useQuery<MeResponseDto>({
    queryKey: ['/api/auth/me'],
  });
  

  const productTier = user?.businessAccount?.productTier || 'chroney';
  const hasJewelryAccess = productTier === 'jewelry_showcase' || productTier === 'jewelry_showcase_chroney';
  const isK12Education = user?.businessAccount?.k12EducationEnabled === true;
  const canManageTopScholarContent = isTopScholarSuperAdminView(user);

  const { data: erpConfig } = useQuery<{ configured: boolean; config?: { name: string; isActive: string; lastTestedAt: string | null; lastTestStatus: string | null } } | null>({
    queryKey: ['/api/erp/config'],
    queryFn: async () => {
      const response = await fetch('/api/erp/config', { credentials: 'include' });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: hasJewelryAccess,
  });

  const { data: externalApiConfig } = useQuery<{ configured: boolean; apiBaseUrl: string; apiToken: string } | null>({
    queryKey: ['/api/k12/external-api-config'],
    queryFn: async () => {
      const response = await fetch('/api/k12/external-api-config', { credentials: 'include' });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: canManageTopScholarContent,
  });

  const { data: imageUploadSettings, isLoading: imageUploadSettingsLoading } = useQuery<{ enabled: boolean } | null>({
    queryKey: ['/api/k12/image-upload-settings'],
    queryFn: async () => {
      const response = await fetch('/api/k12/image-upload-settings', { credentials: 'include' });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: isK12Education,
  });

  const imageUploadMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await fetch('/api/k12/image-upload-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error('Failed to update setting');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/k12/image-upload-settings'] });
      toast({ title: 'Setting saved', description: 'Image upload setting has been updated.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
    },
  });

  const { data: widgetSettings, isLoading: settingsLoading } = useQuery<WidgetSettings>({
    queryKey: ['/api/widget-settings'],
    queryFn: async () => {
      const response = await fetch('/api/widget-settings', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch settings');
      return response.json();
    }
  });

  useEffect(() => {
    if (widgetSettings?.showcaseThemeColor) {
      setShowcaseThemeColor(widgetSettings.showcaseThemeColor);
    }
    if (widgetSettings?.showcaseThemePreset) {
      setShowcaseThemePreset(widgetSettings.showcaseThemePreset as ThemePreset);
    }
  }, [widgetSettings]);

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('logo', file);
      const response = await fetch('/api/widget-settings/showcase-logo/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      if (!response.ok) throw new Error('Failed to upload logo');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/widget-settings'] });
      toast({
        title: "Logo uploaded",
        description: "Your showcase logo has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const deleteLogoMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/widget-settings/showcase-logo', {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to delete logo');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/widget-settings'] });
      toast({
        title: "Logo removed",
        description: "Your showcase logo has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const saveThemeMutation = useMutation({
    mutationFn: async (data: { preset: ThemePreset; color: string }) => {
      const response = await fetch('/api/widget-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          showcaseThemePreset: data.preset,
          showcaseThemeColor: data.color 
        })
      });
      if (!response.ok) throw new Error('Failed to save theme settings');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/widget-settings'] });
      toast({
        title: "Theme saved",
        description: "Vista theme updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const response = await fetch("/api/settings/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to change password");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Password changed successfully",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordError("");
    },
    onError: (error: any) => {
      setPasswordError(error.message || "Failed to change password");
    },
  });

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("All fields are required");
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters long");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }

    changePasswordMutation.mutate({
      currentPassword,
      newPassword,
    });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadLogoMutation.mutate(file);
    }
  };

  const handleThemeSave = () => {
    saveThemeMutation.mutate({ preset: showcaseThemePreset, color: showcaseThemeColor });
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings2 className="w-6 h-6 text-purple-600" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your account settings
        </p>
      </div>

      <div className="space-y-6">
        {hasJewelryAccess && (
          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-purple-50 to-pink-50 py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                Vista Customization
              </CardTitle>
              <CardDescription className="mt-1">
                Choose a luxe theme and customize your Vista appearance
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {settingsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <Label className="text-sm font-medium mb-4 block">
                      Luxe Theme
                    </Label>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {(Object.keys(LUXE_THEMES) as ThemePreset[]).map((key) => {
                        const theme = LUXE_THEMES[key];
                        const isSelected = showcaseThemePreset === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              setShowcaseThemePreset(key);
                              setShowcaseThemeColor(theme.primary);
                              saveThemeMutation.mutate({ preset: key, color: theme.primary });
                            }}
                            className={`relative p-4 rounded-xl border-2 transition-all duration-300 text-left ${
                              isSelected 
                                ? 'border-purple-500 ring-2 ring-purple-200 shadow-lg scale-[1.02]' 
                                : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                            }`}
                            style={{ backgroundColor: theme.bg }}
                          >
                            {isSelected && (
                              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center">
                                <Check className="w-3 h-3 text-white" />
                              </div>
                            )}
                            <div 
                              className="h-16 rounded-lg mb-3 flex items-center justify-center"
                              style={{ 
                                background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
                              }}
                            >
                              <div 
                                className="w-8 h-8 rounded-full"
                                style={{ backgroundColor: theme.accent, opacity: 0.8 }}
                              />
                            </div>
                            <h4 
                              className="font-semibold text-sm"
                              style={{ color: theme.text }}
                            >
                              {theme.name}
                            </h4>
                            <p 
                              className="text-xs mt-1 opacity-70"
                              style={{ color: theme.text }}
                            >
                              {theme.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium mb-3 block">
                      Brand Logo
                    </Label>
                    <div className="flex items-center gap-4">
                      {widgetSettings?.showcaseLogo ? (
                        <div className="relative">
                          <img 
                            src={widgetSettings.showcaseLogo} 
                            alt="Showcase logo" 
                            className="h-16 w-auto max-w-32 object-contain rounded border border-gray-200 bg-white p-1"
                          />
                          <Button
                            variant="destructive"
                            size="icon"
                            className="absolute -top-2 -right-2 h-6 w-6"
                            onClick={() => deleteLogoMutation.mutate()}
                            disabled={deleteLogoMutation.isPending}
                          >
                            {deleteLogoMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      ) : (
                        <div className="h-16 w-32 flex items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50">
                          <span className="text-xs text-muted-foreground">No logo</span>
                        </div>
                      )}
                      <div>
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleLogoUpload}
                          className="hidden"
                        />
                        <Button
                          variant="outline"
                          onClick={() => logoInputRef.current?.click()}
                          disabled={uploadLogoMutation.isPending}
                        >
                          {uploadLogoMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4 mr-2" />
                              Upload Logo
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Your brand logo will appear in Vista header. Recommended size: 200x50px.
                    </p>
                  </div>

                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Visual Search Settings - Only for Jewelry Showcase users */}
        {hasJewelryAccess && (
          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-amber-50 to-orange-50 py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-amber-600" />
                Visual Search Settings
              </CardTitle>
              <CardDescription className="mt-1">
                Configure match thresholds and similarity labels for visual product search
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">Match Thresholds</h4>
                    </div>
                    <p className="text-sm text-gray-500">
                      Set minimum match % and configure Perfect Match, Very Similar labels
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation("/admin/visual-search-settings")}
                  className="gap-1"
                >
                  Configure
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ERP Integration - Only for Jewelry Showcase users */}
        {hasJewelryAccess && (
          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-cyan-50 py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-600" />
                ERP Integration
              </CardTitle>
              <CardDescription className="mt-1">
                Sync products from your ERP system for visual search
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white font-bold text-sm">
                    ERP
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{erpConfig?.config?.name || 'ERP System'}</h4>
                      {erpConfig?.config?.isActive === 'true' && erpConfig?.config?.lastTestStatus === 'success' ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="h-3 w-3" />
                          Connected
                        </span>
                      ) : erpConfig?.configured ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full">
                          Configured
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">Not configured</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      Connect to SAP, Oracle, or custom REST APIs
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation("/admin/erp")}
                  className="gap-1"
                >
                  Configure
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {canManageTopScholarContent && (
          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-cyan-50 to-blue-50 py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="w-4 h-4 text-cyan-600" />
                External Content API
              </CardTitle>
              <CardDescription className="mt-1">
                Connect your content management system to power the AI tutor
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
                    API
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">Content API</h4>
                      {externalApiConfig?.configured ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="h-3 w-3" />
                          Connected
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">Not configured</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      Fetch topics, notes, videos, and questions from your system
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation("/admin/topscholar")}
                  className="gap-1"
                >
                  Configure
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {canManageTopScholarContent && (
          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-violet-50 to-purple-50 py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-violet-600" />
                Content Sync
              </CardTitle>
              <CardDescription className="mt-1">
                Resolve Plan IDs and sync curriculum content into the chatbot's database
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
                    <RefreshCw className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-medium">Plan IDs &amp; Sync Status</h4>
                    <p className="text-sm text-gray-500">
                      Resolve cp_ids, run sample or full syncs, and track sync progress
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLocation("/admin/content-sync")}
                  className="gap-1"
                >
                  Open
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isK12Education && (
          <Card className="shadow-lg border-gray-200">
            <CardHeader className="border-b bg-gradient-to-r from-cyan-50 to-blue-50 py-4">
              <CardTitle className="text-base flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-cyan-600" />
                Photo Upload Feature
              </CardTitle>
              <CardDescription className="mt-1">
                Allow students to upload a photo of a question and ask about it
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
                <div>
                  <h4 className="font-medium text-sm">Upload a photo of your question</h4>
                  <p className="text-sm text-gray-500 mt-0.5">Students can take a photo of a problem and the AI will read it and ask what they'd like help with</p>
                </div>
                <div className="flex items-center gap-3">
                  {imageUploadSettingsLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                  ) : (
                    <Switch
                      checked={imageUploadSettings?.enabled ?? false}
                      onCheckedChange={(checked) => imageUploadMutation.mutate(checked)}
                      disabled={imageUploadMutation.isPending}
                    />
                  )}
                  <span className="text-xs text-gray-500 w-12">
                    {imageUploadSettings?.enabled ? 'On' : 'Off'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-lg border-gray-200">
          <CardHeader className="border-b bg-gradient-to-r from-purple-50 to-pink-50 py-4">
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="w-4 h-4 text-purple-600" />
              Change Password
            </CardTitle>
            <CardDescription className="mt-1">
              Update your password to keep your account secure
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <Label htmlFor="currentPassword" className="text-sm font-medium">
                  Current Password
                </Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="newPassword" className="text-sm font-medium">
                  New Password
                </Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Must be at least 8 characters long
                </p>
              </div>

              <div>
                <Label htmlFor="confirmPassword" className="text-sm font-medium">
                  Confirm New Password
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="mt-2"
                />
              </div>

              {passwordError && (
                <div className="flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="w-4 h-4" />
                  <span>{passwordError}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={changePasswordMutation.isPending}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
              >
                {changePasswordMutation.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Changing Password...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 mr-2" />
                    Change Password
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
