import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Settings2, Lock, AlertCircle, Sparkles, Database, Download, Brain, CheckCircle2, XCircle, Loader2, RefreshCw, Cloud, Trash2, Calendar, HardDrive, ChevronRight, ArrowDownToLine, Upload, Copy, Check, ExternalLink } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface FAQEmbeddingStats {
  totalFAQs: number;
  embeddedFAQs: number;
  missingEmbeddings: number;
  businessesWithFAQs: number;
}

interface ProductEmbeddingStats {
  totalProducts: number;
  embeddedProducts: number;
  missingEmbeddings: number;
  businessesWithProducts: number;
}

interface BackupFile {
  key: string;
  size: number;
  lastModified: string;
  type: "daily" | "weekly" | "monthly" | "manual";
  url?: string;
}

interface BackupStats {
  totalBackups: number;
  totalSize: number;
  byType: { daily: number; weekly: number; monthly: number; manual: number };
  oldestBackup: string | null;
  newestBackup: string | null;
}

interface RestoreHistoryItem {
  id: string;
  backupKey: string;
  backupType: string;
  backupDate: string;
  restoredByEmail: string | null;
  durationMs: string | null;
  status: string;
  restoredAt: string;
}

interface BackupJobHistory {
  id: string;
  correlationId: string;
  operation: 'create' | 'restore' | 'cleanup';
  status: 'pending' | 'running' | 'completed' | 'failed';
  backupType: string | null;
  backupKey: string | null;
  fileSizeBytes: string | null;
  durationMs: string | null;
  errorMessage: string | null;
  errorDetails: string | null;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
}

interface BackupJob {
  id: string;
  status: 'pending' | 'dumping' | 'compressing' | 'uploading' | 'completed' | 'failed';
  progress: number;
  message: string;
  startedAt: string;
  completedAt?: string;
  result?: {
    success: boolean;
    filename?: string;
    size?: number;
    type?: 'daily' | 'weekly' | 'monthly' | 'manual';
    error?: string;
  };
}

interface BatchEmbedResult {
  success: boolean;
  message: string;
  totalProcessed: number;
  totalEmbedded: number;
  totalSkipped: number;
  totalFailed: number;
  businessResults: Array<{
    businessAccountId: string;
    businessName: string;
    embedded: number;
    skipped: number;
    failed: number;
    error?: string;
  }>;
}

export default function SuperAdminSettings() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  
  // FAQ embedding state
  const [embedResult, setEmbedResult] = useState<BatchEmbedResult | null>(null);

  // Backup job state
  const [activeBackupJob, setActiveBackupJob] = useState<BackupJob | null>(null);
  const [backupJobId, setBackupJobId] = useState<string | null>(null);

  // Poll for backup job status
  const pollBackupStatus = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`/api/super-admin/backups/job-status/${jobId}`, { 
        credentials: 'include' 
      });
      if (!response.ok) {
        if (response.status === 404) {
          setBackupJobId(null);
          setActiveBackupJob(null);
          return null;
        }
        throw new Error('Failed to get job status');
      }
      const job: BackupJob = await response.json();
      setActiveBackupJob(job);
      
      if (job.status === 'completed') {
        setBackupJobId(null);
        setActiveBackupJob(null);
        queryClient.invalidateQueries({ queryKey: ['/api/super-admin/backups'] });
        queryClient.invalidateQueries({ queryKey: ['/api/super-admin/backups/stats'] });
        queryClient.invalidateQueries({ queryKey: ['/api/super-admin/backups/failed-jobs'] });
        toast({
          title: "Backup Completed",
          description: job.result?.filename 
            ? `${job.result.type} backup created (${((job.result.size || 0) / 1024 / 1024).toFixed(2)} MB)`
            : "Backup completed successfully",
        });
      } else if (job.status === 'failed') {
        setBackupJobId(null);
        setActiveBackupJob(null);
        toast({
          title: "Backup Failed",
          description: job.result?.error || "Backup failed",
          variant: "destructive",
        });
      }
      return job;
    } catch (error) {
      console.error('Error polling backup status:', error);
      setBackupJobId(null);
      setActiveBackupJob(null);
      return null;
    }
  }, [queryClient, toast]);

  useEffect(() => {
    if (!backupJobId) return;

    const interval = setInterval(() => {
      pollBackupStatus(backupJobId);
    }, 2000);

    pollBackupStatus(backupJobId);

    return () => clearInterval(interval);
  }, [backupJobId, pollBackupStatus]);

  // Check for active backup job on mount
  useEffect(() => {
    const checkActiveJob = async () => {
      try {
        const response = await fetch('/api/super-admin/backups/active-job', { 
          credentials: 'include' 
        });
        if (response.ok) {
          const data = await response.json();
          if (data.hasActiveJob) {
            setBackupJobId(data.job.id);
            setActiveBackupJob(data.job);
          }
        }
      } catch (error) {
        console.error('Error checking active backup job:', error);
      }
    };
    checkActiveJob();
  }, []);

  // R2 Backup queries
  const { data: backups, isLoading: backupsLoading, refetch: refetchBackups } = useQuery<BackupFile[]>({
    queryKey: ['/api/super-admin/backups'],
    queryFn: async () => {
      const response = await fetch('/api/super-admin/backups', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch backups');
      return response.json();
    }
  });

  const { data: backupStats, isLoading: statsBackupLoading, refetch: refetchBackupStats } = useQuery<BackupStats>({
    queryKey: ['/api/super-admin/backups/stats'],
    queryFn: async () => {
      const response = await fetch('/api/super-admin/backups/stats', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch backup stats');
      return response.json();
    }
  });

  const { data: restoreHistory, refetch: refetchRestoreHistory } = useQuery<RestoreHistoryItem[]>({
    queryKey: ['/api/super-admin/backups/restore-history'],
    queryFn: async () => {
      const response = await fetch('/api/super-admin/backups/restore-history', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch restore history');
      return response.json();
    }
  });

  const { data: failedJobs, refetch: refetchFailedJobs } = useQuery<BackupJobHistory[]>({
    queryKey: ['/api/super-admin/backups/failed-jobs'],
    queryFn: async () => {
      const response = await fetch('/api/super-admin/backups/failed-jobs', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch failed jobs');
      return response.json();
    }
  });

  const deleteFailedJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetch(`/api/super-admin/backups/jobs/${jobId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete job');
      }
      return response.json();
    },
    onSuccess: () => {
      refetchFailedJobs();
      toast({ title: "Deleted", description: "Failed backup record removed." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Trigger R2 backup mutation (async)
  const triggerBackupMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/super-admin/backups/trigger', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to trigger backup');
      }
      return response.json();
    },
    onSuccess: (result: { success: boolean; jobId: string; message: string }) => {
      setBackupJobId(result.jobId);
      toast({
        title: "Backup Started",
        description: "Backup is running in the background. Progress will be shown below.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to start backup",
        variant: "destructive",
      });
    },
  });

  const cancelBackupMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/super-admin/backups/cancel', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to cancel backup');
      }
      return response.json();
    },
    onSuccess: () => {
      setActiveBackupJob(null);
      setBackupJobId(null);
      toast({
        title: "Backup Cancelled",
        description: "The ongoing backup has been cancelled.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/super-admin/backups/active-job'] });
      queryClient.invalidateQueries({ queryKey: ['/api/super-admin/backups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/super-admin/backups/stats'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cancel backup",
        variant: "destructive",
      });
    },
  });

  // Cleanup old backups mutation
  const cleanupBackupsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/super-admin/backups/cleanup', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to cleanup backups');
      }
      return response.json();
    },
    onSuccess: (result) => {
      refetchBackups();
      refetchBackupStats();
      toast({
        title: "Cleanup Complete",
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cleanup backups",
        variant: "destructive",
      });
    },
  });

  // Copy-to-clipboard state for R2 URLs
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Restore backup mutation
  const [restoringBackup, setRestoringBackup] = useState<string | null>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [backupToRestore, setBackupToRestore] = useState<string | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreBackupMutation = useMutation({
    mutationFn: async (backupKey: string) => {
      setRestoringBackup(backupKey);
      const response = await fetch('/api/super-admin/backups/restore', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupKey }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to restore backup');
      }
      return response.json();
    },
    onSuccess: (result) => {
      setRestoringBackup(null);
      refetchRestoreHistory();
      toast({
        title: "Restore Complete",
        description: `Database restored successfully in ${(result.duration / 1000).toFixed(1)} seconds`,
      });
    },
    onError: (error: any) => {
      setRestoringBackup(null);
      refetchRestoreHistory();
      toast({
        title: "Restore Failed",
        description: error.message || "Failed to restore database",
        variant: "destructive",
      });
    },
  });

  const { data: restoreProgress } = useQuery<{
    active: boolean;
    stage: string;
    stageNumber: number;
    totalStages: number;
    percent: number;
    detail: string;
    startedAt: number;
    error?: string;
    verificationReport?: { tableName: string; expected: number; actual: number; status: 'ok' | 'mismatch' | 'recovered' | 'failed' }[];
  }>({
    queryKey: ['/api/super-admin/backups/restore-progress'],
    queryFn: async () => {
      const response = await fetch('/api/super-admin/backups/restore-progress', { credentials: 'include' });
      if (response.status === 401) {
        return { active: false, stage: 'idle', stageNumber: 0, totalStages: 7, percent: 0, detail: '', startedAt: 0 };
      }
      if (!response.ok) throw new Error('Failed to fetch restore progress');
      return response.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (restoringBackup) return 1000;
      if (data && data.active) return 1500;
      return false;
    },
  });

  // FAQ embedding stats query
  const { data: faqStats, isLoading: statsLoading, refetch: refetchStats } = useQuery<FAQEmbeddingStats>({
    queryKey: ['/api/system/faq-embedding-stats'],
    queryFn: async () => {
      const response = await fetch('/api/system/faq-embedding-stats', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch FAQ embedding stats');
      return response.json();
    }
  });

  // Batch embed mutation
  const batchEmbedMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/system/faq-batch-embed', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to batch embed FAQs');
      }
      return response.json();
    },
    onSuccess: (result: BatchEmbedResult) => {
      setEmbedResult(result);
      refetchStats();
      toast({
        title: "Batch Embedding Complete",
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to batch embed FAQs",
        variant: "destructive",
      });
    },
  });

  // Product embedding stats query
  const { data: productStats, isLoading: productStatsLoading, refetch: refetchProductStats } = useQuery<ProductEmbeddingStats>({
    queryKey: ['/api/system/product-embedding-stats'],
    queryFn: async () => {
      const response = await fetch('/api/system/product-embedding-stats', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch product embedding stats');
      return response.json();
    }
  });

  // Product batch embed mutation
  const [productEmbedResult, setProductEmbedResult] = useState<BatchEmbedResult | null>(null);
  const productBatchEmbedMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/system/product-batch-embed', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to batch embed products');
      }
      return response.json();
    },
    onSuccess: (result: BatchEmbedResult) => {
      setProductEmbedResult(result);
      refetchProductStats();
      toast({
        title: "Product Batch Embedding Complete",
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to batch embed products",
        variant: "destructive",
      });
    },
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
      // Clear form
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

    // Validate inputs
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

    // Submit password change
    changePasswordMutation.mutate({
      currentPassword,
      newPassword,
    });
  };

  const downloadBackupMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/database/backup", {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to download backup");
      }
      return response.blob();
    },
    onSuccess: (blob) => {
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `database_backup_${Date.now()}.sql`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Success",
        description: "Database backup downloaded successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to download database backup",
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    setIsUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/super-admin/backups/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      toast({
        title: "File Uploaded",
        description: `"${file.name}" has been saved to R2 storage.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/super-admin/backups'] });
      queryClient.invalidateQueries({ queryKey: ['/api/super-admin/backups/stats'] });
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload file to R2",
        variant: "destructive",
      });
    } finally {
      setIsUploadingFile(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 h-screen">
      {/* Header */}
      <header className="flex items-center justify-between h-[56px] px-6 bg-gradient-to-r from-red-500 via-purple-600 to-blue-600 shadow-sm">
        <div className="flex items-center gap-3">
          <SidebarTrigger data-testid="button-sidebar-toggle" className="text-white hover:bg-white/10 rounded-md" />
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-white leading-tight">AI Chroney</h1>
              <p className="text-[11px] text-white/90 leading-tight mt-0.5">Super Admin Settings</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-gray-50">
        <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
          {/* Page Header */}
          <div className="mb-2">
            <h2 className="text-2xl font-bold flex items-center gap-2 text-gray-900">
              <Settings2 className="w-6 h-6 text-purple-600" />
              Settings
            </h2>
            <p className="text-muted-foreground mt-1">
              Manage your Super Admin account settings
            </p>
          </div>

          {/* Change Password Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Lock className="w-5 h-5 text-purple-600" />
                Change Password
              </CardTitle>
              <CardDescription>Update your account password</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handlePasswordChange} className="max-w-md space-y-4">
                  <div>
                    <Label htmlFor="currentPassword" className="text-sm font-medium">
                      Current Password
                    </Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="mt-2"
                      placeholder="Enter your current password"
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
                      className="mt-2"
                      placeholder="Enter new password (min 8 characters)"
                    />
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
                      className="mt-2"
                      placeholder="Confirm your new password"
                    />
                  </div>

                  {passwordError && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
                      <AlertCircle className="w-4 h-4 text-red-600" />
                      <span className="text-sm text-red-600">{passwordError}</span>
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={changePasswordMutation.isPending}
                    className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                  >
                    {changePasswordMutation.isPending ? "Changing Password..." : "Change Password"}
                  </Button>

                  <p className="text-xs text-gray-500">
                    Make sure your new password is at least 8 characters long and contains a mix of letters, numbers, and symbols for better security.
                  </p>
                </form>
            </CardContent>
          </Card>

          {/* Database Backup Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Database className="w-5 h-5 text-purple-600" />
                Database Backup
              </CardTitle>
              <CardDescription>
                Download a complete backup of the database schema and all data
              </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="max-w-md">
                  <Button
                    onClick={() => downloadBackupMutation.mutate()}
                    disabled={downloadBackupMutation.isPending}
                    className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700"
                  >
                    {downloadBackupMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                        Creating Backup...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-2" />
                        Download Database Backup
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-gray-500 mt-3">
                    This will download a SQL file containing the complete database structure and all data. 
                    You can use this file to restore your database or migrate to another environment.
                  </p>
                </div>
            </CardContent>
          </Card>

          {/* Automated Cloud Backups Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Cloud className="w-5 h-5 text-purple-600" />
                Automated Cloud Backups
              </CardTitle>
              <CardDescription>
                Automated backups stored in Cloudflare R2 with tiered retention: Daily (3 days), Weekly (4 weeks), Monthly (3 months)
              </CardDescription>
            </CardHeader>
            <CardContent>

                {/* Backup Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-100">
                    <p className="text-2xl font-bold text-blue-600">
                      {statsBackupLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : backupStats?.totalBackups || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Backups</p>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100">
                    <p className="text-2xl font-bold text-green-600">
                      {statsBackupLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 
                        backupStats?.totalSize ? `${(backupStats.totalSize / 1024 / 1024).toFixed(1)} MB` : '0 MB'}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Size</p>
                  </div>
                  <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-100">
                    <div className="flex gap-1">
                      <span className="text-sm font-bold text-violet-600">{backupStats?.byType.daily || 0}D</span>
                      <span className="text-sm font-bold text-indigo-600">{backupStats?.byType.weekly || 0}W</span>
                      <span className="text-sm font-bold text-purple-600">{backupStats?.byType.monthly || 0}M</span>
                    </div>
                    <p className="text-xs text-muted-foreground">By Type</p>
                  </div>
                  <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl p-4 border border-amber-100">
                    <p className="text-sm font-bold text-amber-600">
                      {backupStats?.newestBackup ? new Date(backupStats.newestBackup).toLocaleDateString() : 'Never'}
                    </p>
                    <p className="text-xs text-muted-foreground">Last Backup</p>
                  </div>
                </div>

                {/* Active Backup Progress */}
                {activeBackupJob && (
                  <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-4 mb-4">
                    <div className="flex items-center gap-3 mb-3">
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                      <div>
                        <p className="font-medium text-blue-800">Backup in Progress</p>
                        <p className="text-sm text-blue-600">{activeBackupJob.message}</p>
                      </div>
                    </div>
                    <div className="w-full bg-blue-100 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-cyan-500 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${activeBackupJob.progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-blue-500 mt-2 text-right">{activeBackupJob.progress}% complete</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3 mb-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="*/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <Button
                    onClick={() => triggerBackupMutation.mutate()}
                    disabled={triggerBackupMutation.isPending || !!activeBackupJob}
                    className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700"
                  >
                    {triggerBackupMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Starting...
                      </>
                    ) : activeBackupJob ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Backup Running...
                      </>
                    ) : (
                      <>
                        <Cloud className="w-4 h-4 mr-2" />
                        Create Backup Now
                      </>
                    )}
                  </Button>
                  {activeBackupJob && (
                    <Button
                      variant="destructive"
                      onClick={() => cancelBackupMutation.mutate()}
                      disabled={cancelBackupMutation.isPending}
                    >
                      {cancelBackupMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Cancelling...
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 mr-2" />
                          Cancel Backup
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => cleanupBackupsMutation.mutate()}
                    disabled={cleanupBackupsMutation.isPending}
                  >
                    {cleanupBackupsMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    Cleanup Old
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingFile}
                  >
                    {isUploadingFile ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 mr-2" />
                    )}
                    {isUploadingFile ? "Uploading..." : "Upload File"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { refetchBackups(); refetchBackupStats(); }}
                    disabled={backupsLoading}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${backupsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>

                {/* Backup List */}
                {backups && backups.length > 0 && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg border max-h-60 overflow-y-auto">
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <HardDrive className="w-4 h-4 text-gray-600" />
                      Recent Backups
                    </h4>
                    <div className="space-y-2">
                      {backups.slice(0, 10).map((backup) => (
                        <div key={backup.key} className="flex items-center justify-between p-2 bg-white rounded border text-sm">
                          <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3 h-3 text-gray-400 flex-shrink-0" />
                              <span className="font-mono text-xs whitespace-nowrap">
                                {backup.key.split('/').pop()}
                              </span>
                              {backup.url && (
                                <>
                                  <button
                                    className="flex-shrink-0 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                    title="Copy R2 URL"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(backup.url ?? '');
                                      setCopiedKey(backup.key);
                                      setTimeout(() => setCopiedKey(null), 1500);
                                    }}
                                  >
                                    {copiedKey === backup.key ? (
                                      <Check className="w-3 h-3 text-green-500" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                  <a
                                    href={backup.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex-shrink-0 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                                    title="Open in new tab"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-2 pl-5">
                              <Badge variant="outline" className={
                                backup.type === 'monthly' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                backup.type === 'weekly' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                                backup.type === 'manual' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                'bg-blue-50 text-blue-700 border-blue-200'
                              }>
                                {backup.type}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {new Date(backup.lastModified).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace(/(\d+)/, (_, d) => { const s = ['th','st','nd','rd']; const v = +d % 100; return d + (s[(v-20)%10] || s[v] || s[0]); })}, {new Date(backup.lastModified).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toUpperCase()}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-xs text-muted-foreground">
                              {(backup.size / 1024 / 1024).toFixed(2)} MB
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                setBackupToRestore(backup.key);
                                setRestoreDialogOpen(true);
                              }}
                              disabled={restoringBackup !== null}
                            >
                              {restoringBackup === backup.key ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3 h-3" />
                              )}
                              <span className="ml-1">Restore</span>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {backups && backups.length === 0 && !backupsLoading && (
                  <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    <span className="text-sm text-amber-700">No cloud backups yet. Create your first backup above.</span>
                  </div>
                )}

                {restoreProgress && (restoreProgress.active || restoreProgress.stage === 'completed' || restoreProgress.stage === 'failed') && (
                  <div className={`mt-4 p-4 rounded-lg border ${
                    restoreProgress.stage === 'failed' 
                      ? 'bg-gradient-to-r from-red-50 to-pink-50 border-red-200' 
                      : restoreProgress.stage === 'completed'
                        ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
                        : 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200'
                  }`}>
                    <div className="flex items-center gap-2 mb-3">
                      {restoreProgress.stage === 'failed' ? (
                        <XCircle className="w-4 h-4 text-red-600" />
                      ) : restoreProgress.stage === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <ArrowDownToLine className="w-4 h-4 text-blue-600 animate-pulse" />
                      )}
                      <h4 className={`font-medium ${
                        restoreProgress.stage === 'failed' ? 'text-red-800' :
                        restoreProgress.stage === 'completed' ? 'text-green-800' : 'text-blue-800'
                      }`}>
                        {restoreProgress.stage === 'failed' ? 'Restore Failed' :
                         restoreProgress.stage === 'completed' ? 'Restore Complete' : 'Restoring Database'}
                      </h4>
                      {restoreProgress.active && (
                        <Badge variant="outline" className="ml-auto bg-blue-100 text-blue-700 border-blue-300 text-xs">
                          Step {restoreProgress.stageNumber} of {restoreProgress.totalStages}
                        </Badge>
                      )}
                    </div>
                    <Progress value={restoreProgress.percent} className={`h-3 mb-2 ${
                      restoreProgress.stage === 'failed' ? '[&>div]:bg-red-500' :
                      restoreProgress.stage === 'completed' ? '[&>div]:bg-green-500' : ''
                    }`} />
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        {restoreProgress.active && <Loader2 className="w-3 h-3 animate-spin text-blue-600" />}
                        <span className={`font-medium ${
                          restoreProgress.stage === 'failed' ? 'text-red-700' :
                          restoreProgress.stage === 'completed' ? 'text-green-700' : 'text-blue-700'
                        }`}>{restoreProgress.stage}</span>
                      </div>
                      <span className={
                        restoreProgress.stage === 'failed' ? 'text-red-600' :
                        restoreProgress.stage === 'completed' ? 'text-green-600' : 'text-blue-600'
                      }>{restoreProgress.percent}%</span>
                    </div>
                    <p className={`text-xs mt-1 ${
                      restoreProgress.stage === 'failed' ? 'text-red-600' :
                      restoreProgress.stage === 'completed' ? 'text-green-600' : 'text-blue-600'
                    }`}>{restoreProgress.detail}</p>

                    {restoreProgress.stage === 'completed' && restoreProgress.verificationReport && restoreProgress.verificationReport.length > 0 && (() => {
                      const report = restoreProgress.verificationReport;
                      const okCount = report.filter(r => r.status === 'ok').length;
                      const recoveredCount = report.filter(r => r.status === 'recovered').length;
                      const failedCount = report.filter(r => r.status === 'failed').length;
                      const issues = report.filter(r => r.status !== 'ok');
                      return (
                        <div className="mt-3 border border-green-200 rounded-md overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 bg-green-100 border-b border-green-200">
                            <span className="text-xs font-semibold text-green-800">Data Integrity Verification</span>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="w-3 h-3" />{okCount} OK</span>
                              {recoveredCount > 0 && <span className="inline-flex items-center gap-1 text-amber-600"><RefreshCw className="w-3 h-3" />{recoveredCount} Recovered</span>}
                              {failedCount > 0 && <span className="inline-flex items-center gap-1 text-red-600"><XCircle className="w-3 h-3" />{failedCount} Failed</span>}
                            </div>
                          </div>
                          {issues.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-green-700 bg-white">All {okCount} tables verified — row counts match exactly.</div>
                          ) : (
                            <div className="bg-white">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-gray-50 border-b border-gray-200">
                                    <th className="text-left px-3 py-1.5 text-gray-600 font-medium">Table</th>
                                    <th className="text-right px-3 py-1.5 text-gray-600 font-medium">Expected</th>
                                    <th className="text-right px-3 py-1.5 text-gray-600 font-medium">Actual</th>
                                    <th className="text-right px-3 py-1.5 text-gray-600 font-medium">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {issues.map((row) => (
                                    <tr key={row.tableName} className="border-b border-gray-100 last:border-0">
                                      <td className="px-3 py-1.5 font-mono text-gray-700">{row.tableName}</td>
                                      <td className="px-3 py-1.5 text-right text-gray-600">{row.expected.toLocaleString()}</td>
                                      <td className="px-3 py-1.5 text-right text-gray-600">{row.actual.toLocaleString()}</td>
                                      <td className="px-3 py-1.5 text-right">
                                        {row.status === 'recovered' && <span className="inline-flex items-center gap-1 text-amber-600 font-medium"><RefreshCw className="w-3 h-3" />Recovered</span>}
                                        {row.status === 'failed' && <span className="inline-flex items-center gap-1 text-red-600 font-medium"><XCircle className="w-3 h-3" />Failed</span>}
                                        {row.status === 'mismatch' && <span className="inline-flex items-center gap-1 text-orange-600 font-medium">Mismatch</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {okCount > 0 && <p className="px-3 py-1.5 text-xs text-gray-500 border-t border-gray-100">{okCount} other tables verified OK.</p>}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Restore History */}
                {restoreHistory && restoreHistory.length > 0 && (
                  <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-blue-600" />
                      Restore History
                    </h4>
                    <div className="space-y-2">
                      {restoreHistory.slice(0, 5).map((restore) => (
                        <div key={restore.id} className="flex items-center justify-between p-2 bg-white rounded border text-sm">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-3 h-3 text-gray-400" />
                            <span className="font-mono text-xs">
                              {restore.backupDate}
                            </span>
                            <Badge variant="outline" className={
                              restore.backupType === 'monthly' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                              restore.backupType === 'weekly' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                              'bg-blue-50 text-blue-700 border-blue-200'
                            }>
                              {restore.backupType}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={
                              restore.status === 'success' ? 'bg-green-50 text-green-700 border-green-200' :
                              'bg-red-50 text-red-700 border-red-200'
                            }>
                              {restore.status === 'success' ? (
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                              ) : (
                                <XCircle className="w-3 h-3 mr-1" />
                              )}
                              {restore.status}
                            </Badge>
                            {restore.durationMs && (
                              <span className="text-xs text-muted-foreground">
                                {(parseInt(restore.durationMs) / 1000).toFixed(1)}s
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {new Date(restore.restoredAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Failed Jobs Section */}
                {failedJobs && failedJobs.length > 0 && (
                  <div className="mt-4 p-4 bg-red-50 rounded-lg border border-red-200">
                    <h4 className="font-medium mb-3 flex items-center gap-2 text-red-700">
                      <XCircle className="w-4 h-4 text-red-600" />
                      Recent Failed Operations
                    </h4>
                    <div className="space-y-2">
                      {failedJobs.slice(0, 5).map((job) => (
                        <div key={job.id} className="p-3 bg-white rounded border border-red-100">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                                {job.operation}
                              </Badge>
                              {job.backupType && (
                                <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200 text-xs">
                                  {job.backupType}
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-gray-500">
                              {new Date(job.startedAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm text-red-600 mb-1">{job.errorMessage || 'Unknown error'}</p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <span>ID: <code className="bg-gray-100 px-1 rounded">{job.correlationId}</code></span>
                              {job.triggeredBy !== 'system' && (
                                <span>by {job.triggeredBy}</span>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => deleteFailedJobMutation.mutate(job.id)}
                              disabled={deleteFailedJobMutation.isPending}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-3">
                  Backups run automatically at 5am daily. Daily backups are kept for 3 days, weekly backups for 4 weeks, and monthly backups for 3 months.
                </p>
            </CardContent>
          </Card>

          {/* R2 Storage Configuration Card */}
          <Card 
            className="cursor-pointer hover:shadow-md transition-all"
            onClick={() => setLocation("/super-admin/r2-storage")}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                    <HardDrive className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">R2 Storage Configuration</h3>
                    <p className="text-sm text-muted-foreground">Configure Cloudflare R2 credentials for file storage</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </div>
            </CardContent>
          </Card>

          {/* FAQ Embedding Migration Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-600" />
                FAQ Embedding Migration
              </CardTitle>
              <CardDescription>
                Generate vector embeddings for all FAQs across all business accounts. This enables semantic search (RAG) for the AI chatbot.
              </CardDescription>
            </CardHeader>
            <CardContent>

                {/* Stats Display */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-100">
                    <p className="text-2xl font-bold text-violet-600">
                      {statsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : faqStats?.totalFAQs || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Total FAQs</p>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100">
                    <p className="text-2xl font-bold text-green-600">
                      {statsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : faqStats?.embeddedFAQs || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Embedded</p>
                  </div>
                  <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl p-4 border border-amber-100">
                    <p className="text-2xl font-bold text-amber-600">
                      {statsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : faqStats?.missingEmbeddings || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Missing</p>
                  </div>
                  <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-100">
                    <p className="text-2xl font-bold text-blue-600">
                      {statsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : faqStats?.businessesWithFAQs || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Businesses</p>
                  </div>
                </div>

                <div className="flex gap-3 mb-4">
                  <Button
                    onClick={() => batchEmbedMutation.mutate()}
                    disabled={batchEmbedMutation.isPending || (faqStats?.missingEmbeddings === 0)}
                    className="bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700"
                  >
                    {batchEmbedMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Embedding FAQs...
                      </>
                    ) : (
                      <>
                        <Brain className="w-4 h-4 mr-2" />
                        Embed All Missing FAQs
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => refetchStats()}
                    disabled={statsLoading}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${statsLoading ? 'animate-spin' : ''}`} />
                    Refresh Stats
                  </Button>
                </div>

                {faqStats?.missingEmbeddings === 0 && !embedResult && (
                  <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-md mb-4">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm text-green-700">All FAQs are already embedded!</span>
                  </div>
                )}

                {/* Batch Embed Results */}
                {embedResult && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Embedding Results
                    </h4>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div className="text-center">
                        <p className="text-xl font-bold text-green-600">{embedResult.totalEmbedded}</p>
                        <p className="text-xs text-muted-foreground">Embedded</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-amber-600">{embedResult.totalSkipped}</p>
                        <p className="text-xs text-muted-foreground">Skipped</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-red-600">{embedResult.totalFailed}</p>
                        <p className="text-xs text-muted-foreground">Failed</p>
                      </div>
                    </div>

                    {embedResult.businessResults.length > 0 && (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        <p className="text-sm font-medium text-muted-foreground">Per Business Results:</p>
                        {embedResult.businessResults.map((br) => (
                          <div key={br.businessAccountId} className="flex items-center justify-between p-2 bg-white rounded border text-sm">
                            <span className="font-medium truncate max-w-[200px]">{br.businessName}</span>
                            <div className="flex items-center gap-2">
                              {br.embedded > 0 && (
                                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                  {br.embedded} embedded
                                </Badge>
                              )}
                              {br.skipped > 0 && (
                                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                                  {br.skipped} skipped
                                </Badge>
                              )}
                              {br.failed > 0 && (
                                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                                  {br.failed} failed
                                </Badge>
                              )}
                              {br.error && (
                                <span className="text-xs text-red-500" title={br.error}>
                                  <XCircle className="w-3 h-3" />
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-3">
                  This process will generate embeddings for FAQs that don't have them yet. 
                  Businesses without an OpenAI API key configured will be skipped.
                </p>
            </CardContent>
          </Card>

          {/* Product Embedding Migration Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-orange-600" />
                Product Embedding Migration
              </CardTitle>
              <CardDescription>
                Generate text embeddings for all products across all business accounts. This enables fast semantic product search for the AI chatbot.
              </CardDescription>
            </CardHeader>
            <CardContent>

                {/* Stats Display */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-xl p-4 border border-orange-100">
                    <p className="text-2xl font-bold text-orange-600">
                      {productStatsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : productStats?.totalProducts || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Products</p>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-100">
                    <p className="text-2xl font-bold text-green-600">
                      {productStatsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : productStats?.embeddedProducts || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Embedded</p>
                  </div>
                  <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl p-4 border border-amber-100">
                    <p className="text-2xl font-bold text-amber-600">
                      {productStatsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : productStats?.missingEmbeddings || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Missing</p>
                  </div>
                  <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-100">
                    <p className="text-2xl font-bold text-blue-600">
                      {productStatsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : productStats?.businessesWithProducts || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Businesses</p>
                  </div>
                </div>

                <div className="flex gap-3 mb-4">
                  <Button
                    onClick={() => productBatchEmbedMutation.mutate()}
                    disabled={productBatchEmbedMutation.isPending || (productStats?.missingEmbeddings === 0)}
                    className="bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700"
                  >
                    {productBatchEmbedMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Embedding Products...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Embed All Missing Products
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => refetchProductStats()}
                    disabled={productStatsLoading}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${productStatsLoading ? 'animate-spin' : ''}`} />
                    Refresh Stats
                  </Button>
                </div>

                {productStats?.missingEmbeddings === 0 && !productEmbedResult && (
                  <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-md mb-4">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span className="text-sm text-green-700">All products are already embedded!</span>
                  </div>
                )}

                {/* Batch Embed Results */}
                {productEmbedResult && (
                  <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Embedding Results
                    </h4>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div className="text-center">
                        <p className="text-xl font-bold text-green-600">{productEmbedResult.totalEmbedded}</p>
                        <p className="text-xs text-muted-foreground">Embedded</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-amber-600">{productEmbedResult.totalSkipped}</p>
                        <p className="text-xs text-muted-foreground">Skipped</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-red-600">{productEmbedResult.totalFailed}</p>
                        <p className="text-xs text-muted-foreground">Failed</p>
                      </div>
                    </div>

                    {/* Business breakdown */}
                    {productEmbedResult.businessResults && productEmbedResult.businessResults.length > 0 && (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {productEmbedResult.businessResults.map((biz: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between text-sm p-2 bg-white rounded border">
                            <span className="font-medium truncate flex-1">{biz.businessName}</span>
                            <div className="flex gap-3 text-xs">
                              <span className="text-green-600">{biz.embedded} embedded</span>
                              {biz.failed > 0 && <span className="text-red-600">{biz.failed} failed</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-gray-500 mt-3">
                  This process will generate text embeddings for products that don't have them yet. 
                  Embeddings enable fast semantic search for product queries.
                </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Restore Backup Confirmation Dialog */}
      <AlertDialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Database Backup</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to restore this backup? This will overwrite your current database with the backup data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setBackupToRestore(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => {
                if (backupToRestore) {
                  restoreBackupMutation.mutate(backupToRestore);
                }
                setRestoreDialogOpen(false);
                setBackupToRestore(null);
              }}
            >
              Restore Backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
