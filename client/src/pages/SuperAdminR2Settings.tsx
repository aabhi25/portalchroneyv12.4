import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { HardDrive, CheckCircle, XCircle, Loader2, Eye, EyeOff, TestTube, Trash2 } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface R2ConfigStatus {
  isConfigured: boolean;
  configSource: "database" | "environment" | "none";
  isEnabled: boolean;
  hasDbConfig: boolean;
  hasEnvConfig: boolean;
}

export default function SuperAdminR2Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [accountId, setAccountId] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [bucketName, setBucketName] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const { data: status, isLoading } = useQuery<R2ConfigStatus>({
    queryKey: ["/api/system/r2-config"],
    queryFn: async () => {
      const res = await fetch("/api/system/r2-config", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch R2 config status");
      return res.json();
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/system/r2-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accountId, accessKeyId, secretAccessKey, bucketName, publicUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection test failed");
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Success", description: data.message });
    },
    onError: (error: any) => {
      toast({ title: "Test Failed", description: error.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/system/r2-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accountId, accessKeyId, secretAccessKey, bucketName, publicUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save configuration");
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Success", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/system/r2-config"] });
      setAccountId("");
      setAccessKeyId("");
      setSecretAccessKey("");
      setBucketName("");
      setPublicUrl("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/system/r2-config", {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete configuration");
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Success", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/system/r2-config"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
      toast({ title: "Validation Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  const isFormValid = accountId && accessKeyId && secretAccessKey && bucketName;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="flex items-center gap-4 p-4 border-b bg-white dark:bg-gray-800">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <HardDrive className="h-6 w-6 text-blue-600" />
          <h1 className="text-xl font-semibold">R2 Storage Settings</h1>
        </div>
      </div>

      <div className="flex-1 p-6 max-w-4xl">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Current Status
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            </CardTitle>
            <CardDescription>
              Cloudflare R2 storage configuration for product images, chat uploads, and avatars
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {status.isEnabled ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                  <span className="font-medium">
                    R2 Storage: {status.isEnabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                
                {status.isConfigured && (
                  <div className="text-sm text-muted-foreground">
                    Configuration source: <span className="font-medium capitalize">{status.configSource}</span>
                    {status.hasDbConfig && " (stored in database - will persist across project transfers)"}
                    {status.hasEnvConfig && !status.hasDbConfig && " (from environment variables)"}
                  </div>
                )}

                {!status.isConfigured && (
                  <Alert>
                    <AlertDescription>
                      R2 storage is not configured. Images will be stored locally and may be lost during project transfers.
                    </AlertDescription>
                  </Alert>
                )}

                {status.hasDbConfig && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Delete Database Config
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configure R2 Storage</CardTitle>
            <CardDescription>
              Enter your Cloudflare R2 credentials. These will be encrypted and stored in the database.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="accountId">Account ID *</Label>
                <Input
                  id="accountId"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  placeholder="Your Cloudflare account ID"
                />
                <p className="text-xs text-muted-foreground">
                  Found in your Cloudflare dashboard URL: dash.cloudflare.com/[ACCOUNT_ID]/r2
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bucketName">Bucket Name *</Label>
                <Input
                  id="bucketName"
                  value={bucketName}
                  onChange={(e) => setBucketName(e.target.value)}
                  placeholder="Your R2 bucket name"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="accessKeyId">Access Key ID *</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSecrets(!showSecrets)}
                  >
                    {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    {showSecrets ? "Hide" : "Show"}
                  </Button>
                </div>
                <Input
                  id="accessKeyId"
                  type={showSecrets ? "text" : "password"}
                  value={accessKeyId}
                  onChange={(e) => setAccessKeyId(e.target.value)}
                  placeholder="R2 API Token Access Key"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="secretAccessKey">Secret Access Key *</Label>
                <Input
                  id="secretAccessKey"
                  type={showSecrets ? "text" : "password"}
                  value={secretAccessKey}
                  onChange={(e) => setSecretAccessKey(e.target.value)}
                  placeholder="R2 API Token Secret Key"
                />
                <p className="text-xs text-muted-foreground">
                  Get these from: R2 → Manage R2 API Tokens → Create API Token
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="publicUrl">Public URL (Optional)</Label>
                <Input
                  id="publicUrl"
                  value={publicUrl}
                  onChange={(e) => setPublicUrl(e.target.value)}
                  placeholder="https://pub-xxx.r2.dev or your custom domain"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to use the default R2 public URL. Only needed if you have a custom domain.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => testMutation.mutate()}
                  disabled={!isFormValid || testMutation.isPending}
                >
                  {testMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <TestTube className="h-4 w-4 mr-2" />
                  )}
                  Test Connection
                </Button>

                <Button
                  type="submit"
                  disabled={!isFormValid || saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <HardDrive className="h-4 w-4 mr-2" />
                  )}
                  Save Configuration
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-600" />
              Delete R2 Configuration
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the R2 configuration from the database? 
              Files will be stored locally until you configure R2 storage again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteMutation.mutate();
                setDeleteDialogOpen(false);
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Delete Configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
