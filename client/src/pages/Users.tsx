import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Users, Building2, Copy, Check, Eye, KeyRound } from "lucide-react";
import type { User } from "@shared/schema";
import type { BusinessAccountDto } from "@shared/dto/businessAccount";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Sparkles } from "lucide-react";

export default function UsersPage() {
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [filterBusinessId, setFilterBusinessId] = useState<string>("all");
  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; password: string } | null>(null);
  const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
  const [isCredentialsDialogOpen, setIsCredentialsDialogOpen] = useState(false);
  const [isResetPasswordDialogOpen, setIsResetPasswordDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [viewedCredentials, setViewedCredentials] = useState<any>(null);
  const [resetPasswordCredentials, setResetPasswordCredentials] = useState<{ username: string; password: string } | null>(null);
  const [newTempPassword, setNewTempPassword] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch all business accounts
  const { data: businessAccounts = [] } = useQuery<BusinessAccountDto[]>({
    queryKey: ["/api/business-accounts", "all"],
    queryFn: async () => {
      const data = await apiRequest("GET", "/api/business-accounts?limit=1000");
      // API returns { accounts: [...], total, hasMore } - extract accounts array
      return (data as any).accounts || data;
    },
  });

  // Fetch all users for all business accounts
  const { data: allUsers = [], isLoading } = useQuery<User[]>({
    queryKey: ["/api/users/all"],
    queryFn: async () => {
      // Fetch users for each business account and combine
      const usersPromises = businessAccounts.map((business) =>
        apiRequest<User[]>("GET", `/api/business-accounts/${business.id}/users`)
      );
      const usersArrays = await Promise.all(usersPromises);
      return usersArrays.flat();
    },
    enabled: businessAccounts.length > 0,
  });

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
      toast({
        title: "Copied!",
        description: `${fieldName} copied to clipboard`,
      });
    } catch (err) {
      toast({
        title: "Failed to copy",
        description: "Please copy manually",
        variant: "destructive",
      });
    }
  };

  // Create business user mutation
  const createUserMutation = useMutation({
    mutationFn: async (data: { businessAccountId: string; username: string; password: string }) => {
      return await apiRequest<User & { credentials: { username: string; password: string } }>(
        "POST",
        `/api/business-accounts/${data.businessAccountId}/users`,
        { username: data.username, password: data.password }
      );
    },
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/all"] });
      setNewUserUsername("");
      setNewUserPassword("");
      setCreatedCredentials(user.credentials);
      toast({
        title: "Success",
        description: "Business user created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    },
  });

  // View credentials mutation
  const viewCredentialsMutation = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest<any>("GET", `/api/users/${userId}/credentials`);
    },
    onSuccess: (credentials) => {
      setViewedCredentials(credentials);
      setIsCredentialsDialogOpen(true);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to view credentials",
        variant: "destructive",
      });
    },
  });

  // Reset password mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async (data: { userId: string; password: string }) => {
      return await apiRequest<{ success: boolean; credentials: { username: string; password: string } }>(
        "POST",
        `/api/users/${data.userId}/reset-password`,
        { password: data.password }
      );
    },
    onSuccess: (response) => {
      setNewTempPassword("");
      setResetPasswordCredentials(response.credentials);
      toast({
        title: "Success",
        description: "Password reset successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reset password",
        variant: "destructive",
      });
    },
  });

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newUserUsername.trim())) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }
    
    if (selectedBusinessId && newUserUsername.trim() && newUserPassword.trim()) {
      createUserMutation.mutate({
        businessAccountId: selectedBusinessId,
        username: newUserUsername.trim(),
        password: newUserPassword.trim(),
      });
    }
  };

  const getUserBusinessName = (businessAccountId: string | null) => {
    if (!businessAccountId) return "N/A";
    const business = businessAccounts.find((b) => b.id === businessAccountId);
    return business?.name || "Unknown";
  };

  // Filter users based on selected business account
  const filteredUsers = filterBusinessId === "all" 
    ? allUsers 
    : allUsers.filter(user => user.businessAccountId === filterBusinessId);

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
              <p className="text-[11px] text-white/90 leading-tight mt-0.5">Users Management</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-gray-50">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
          <div className="flex items-start justify-between mb-6 gap-6">
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-gray-900">Users</h2>
              <p className="text-muted-foreground mt-1">
                Manage all business users across the platform
              </p>
              
              {/* Filter Dropdown */}
              <div className="mt-4 max-w-xs">
                <Label htmlFor="businessFilter" className="text-sm font-medium text-gray-700 mb-2 block">
                  Filter by Business Account
                </Label>
                <Select value={filterBusinessId} onValueChange={setFilterBusinessId}>
                  <SelectTrigger id="businessFilter" className="bg-white" data-testid="select-filter-business">
                    <SelectValue placeholder="All Business Accounts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Business Accounts</SelectItem>
                    {businessAccounts.map((business) => (
                      <SelectItem key={business.id} value={business.id}>
                        {business.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Dialog open={isUserDialogOpen} onOpenChange={(open) => {
              setIsUserDialogOpen(open);
              if (!open) {
                setSelectedBusinessId("");
                setCreatedCredentials(null);
                setNewUserUsername("");
                setNewUserPassword("");
              }
            }}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 shadow-sm" data-testid="button-create-user">
                  <UserPlus className="w-4 h-4 mr-2" />
                  Add User
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Business User</DialogTitle>
                  <DialogDescription>
                    Add a new user to a business account
                  </DialogDescription>
                </DialogHeader>
                
                {createdCredentials ? (
                  <div className="space-y-6">
                    {/* Success Header */}
                    <div className="text-center p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg border-2 border-green-200">
                      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                        <Users className="w-8 h-8 text-green-600" />
                      </div>
                      <h3 className="text-lg font-bold text-green-900 mb-1">User Created Successfully!</h3>
                      <p className="text-sm text-green-700">Save these credentials immediately</p>
                    </div>

                    {/* Credentials Display */}
                    <div className="space-y-4">
                      {/* Username */}
                      <div>
                        <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 block">
                          Username
                        </Label>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-50 border-2 border-gray-200 rounded-lg px-4 py-3">
                            <code className="text-base font-mono font-semibold text-gray-900 select-all">
                              {createdCredentials.username}
                            </code>
                          </div>
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => copyToClipboard(createdCredentials.username, "Username")}
                            className="h-12 w-12 border-2"
                            data-testid="button-copy-username"
                          >
                            {copiedField === "Username" ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Temporary Password */}
                      <div>
                        <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 block">
                          Temporary Password
                        </Label>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-amber-50 border-2 border-amber-300 rounded-lg px-4 py-3">
                            <code className="text-base font-mono font-semibold text-gray-900 select-all">
                              {createdCredentials.password}
                            </code>
                          </div>
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => copyToClipboard(createdCredentials.password, "Password")}
                            className="h-12 w-12 border-2 border-amber-300"
                            data-testid="button-copy-password"
                          >
                            {copiedField === "Password" ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Warning */}
                    <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
                      <div className="flex gap-3">
                        <div className="flex-shrink-0">
                          <span className="text-2xl">⚠️</span>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-red-900">Important: Save These Credentials Now!</p>
                          <p className="text-sm text-red-800">
                            The password cannot be retrieved later. Make sure to copy and securely share these credentials with the business user.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      <Button 
                        onClick={() => {
                          setCreatedCredentials(null);
                          setNewUserUsername("");
                          setNewUserPassword("");
                          setSelectedBusinessId("");
                        }}
                        className="flex-1"
                        variant="outline"
                      >
                        Create Another User
                      </Button>
                      <Button 
                        onClick={() => {
                          setIsUserDialogOpen(false);
                          setCreatedCredentials(null);
                          setNewUserUsername("");
                          setNewUserPassword("");
                          setSelectedBusinessId("");
                        }}
                        className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600"
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleCreateUser} className="space-y-4">
                    <div>
                      <Label htmlFor="businessAccount">Business Account</Label>
                      <Select value={selectedBusinessId} onValueChange={setSelectedBusinessId} required>
                        <SelectTrigger className="mt-1.5" data-testid="select-business-account">
                          <SelectValue placeholder="Select a business account" />
                        </SelectTrigger>
                        <SelectContent>
                          {businessAccounts.map((business) => (
                            <SelectItem key={business.id} value={business.id}>
                              {business.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="username">User ID / Email</Label>
                      <Input
                        id="username"
                        type="email"
                        placeholder="user@example.com"
                        value={newUserUsername}
                        onChange={(e) => setNewUserUsername(e.target.value)}
                        required
                        data-testid="input-user-username"
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="Enter password"
                        value={newUserPassword}
                        onChange={(e) => setNewUserPassword(e.target.value)}
                        required
                        data-testid="input-user-password"
                        className="mt-1.5"
                      />
                    </div>
                    <Button type="submit" disabled={createUserMutation.isPending} data-testid="button-submit-user" className="w-full">
                      {createUserMutation.isPending ? "Creating..." : "Create User"}
                    </Button>
                  </form>
                )}
              </DialogContent>
            </Dialog>
          </div>

          {isLoading ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-sm text-gray-600">Loading users...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {allUsers.length === 0 ? "No users yet" : "No users found"}
              </h3>
              <p className="text-sm text-gray-600">
                {allUsers.length === 0 
                  ? "Create your first user to get started"
                  : "No users found for the selected business account"}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold py-3">User ID / Email</TableHead>
                    <TableHead className="font-semibold py-3">Business Account</TableHead>
                    <TableHead className="font-semibold py-3">Last Login</TableHead>
                    <TableHead className="font-semibold py-3">Created</TableHead>
                    <TableHead className="text-right font-semibold py-3">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user.id} className="hover:bg-gray-50">
                      <TableCell className="font-medium py-3">{user.username}</TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-purple-600" />
                          <span className="text-sm">{getUserBusinessName(user.businessAccountId)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-gray-600 py-3">
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleDateString()
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600 py-3">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedUserId(user.id);
                              viewCredentialsMutation.mutate(user.id);
                            }}
                            disabled={viewCredentialsMutation.isPending}
                            data-testid={`button-view-credentials-${user.id}`}
                          >
                            <Eye className="h-4 w-4 mr-1.5" />
                            View
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedUserId(user.id);
                              setIsResetPasswordDialogOpen(true);
                            }}
                            data-testid={`button-reset-password-${user.id}`}
                          >
                            <KeyRound className="h-4 w-4 mr-1.5" />
                            Reset
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {/* View Credentials Dialog */}
      <Dialog open={isCredentialsDialogOpen} onOpenChange={(open) => {
        setIsCredentialsDialogOpen(open);
        if (!open) {
          setViewedCredentials(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>User Credentials</DialogTitle>
            <DialogDescription>
              View temporary password and login credentials
            </DialogDescription>
          </DialogHeader>
          
          {viewedCredentials && (
            <div className="space-y-4">
              {/* Username */}
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 block">
                  Username
                </Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-50 border-2 border-gray-200 rounded-lg px-4 py-3">
                    <code className="text-base font-mono font-semibold text-gray-900 select-all">
                      {viewedCredentials.username}
                    </code>
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => copyToClipboard(viewedCredentials.username, "Username")}
                    className="h-12 w-12 border-2"
                    data-testid="button-copy-view-username"
                  >
                    {copiedField === "Username" ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Temporary Password */}
              {viewedCredentials.hasCredentials ? (
                <div>
                  <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 block">
                    Temporary Password
                  </Label>
                  <div className="flex items-center gap-2">
                    <div className={`flex-1 ${viewedCredentials.isExpired ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'} border-2 rounded-lg px-4 py-3`}>
                      <code className="text-base font-mono font-semibold text-gray-900 select-all">
                        {viewedCredentials.tempPassword || "No password available"}
                      </code>
                    </div>
                    {viewedCredentials.tempPassword && (
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => copyToClipboard(viewedCredentials.tempPassword, "Password")}
                        className={`h-12 w-12 border-2 ${viewedCredentials.isExpired ? 'border-red-300' : 'border-amber-300'}`}
                        data-testid="button-copy-view-password"
                      >
                        {copiedField === "Password" ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                  {viewedCredentials.tempPasswordExpiry && (
                    <p className={`text-xs mt-1.5 ${viewedCredentials.isExpired ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                      {viewedCredentials.isExpired ? '⚠️ Expired on' : 'Expires on'}: {new Date(viewedCredentials.tempPasswordExpiry).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 border-2 border-gray-200 rounded-lg p-4 text-center">
                  <p className="text-sm text-gray-600">No temporary password available. Please reset the password.</p>
                </div>
              )}

              <Button 
                onClick={() => setIsCredentialsDialogOpen(false)}
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600"
              >
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={isResetPasswordDialogOpen} onOpenChange={(open) => {
        setIsResetPasswordDialogOpen(open);
        if (!open) {
          setResetPasswordCredentials(null);
          setNewTempPassword("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset User Password</DialogTitle>
            <DialogDescription>
              Generate a new temporary password for this user
            </DialogDescription>
          </DialogHeader>
          
          {resetPasswordCredentials ? (
            <div className="space-y-6">
              {/* Success Header */}
              <div className="text-center p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg border-2 border-green-200">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <KeyRound className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-bold text-green-900 mb-1">Password Reset Successfully!</h3>
                <p className="text-sm text-green-700">Save these credentials immediately</p>
              </div>

              {/* Credentials Display */}
              <div className="space-y-4">
                {/* Username */}
                <div>
                  <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 block">
                    Username
                  </Label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-50 border-2 border-gray-200 rounded-lg px-4 py-3">
                      <code className="text-base font-mono font-semibold text-gray-900 select-all">
                        {resetPasswordCredentials.username}
                      </code>
                    </div>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => copyToClipboard(resetPasswordCredentials.username, "Username")}
                      className="h-12 w-12 border-2"
                      data-testid="button-copy-reset-username"
                    >
                      {copiedField === "Username" ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* New Temporary Password */}
                <div>
                  <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 block">
                    New Temporary Password
                  </Label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-amber-50 border-2 border-amber-300 rounded-lg px-4 py-3">
                      <code className="text-base font-mono font-semibold text-gray-900 select-all">
                        {resetPasswordCredentials.password}
                      </code>
                    </div>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => copyToClipboard(resetPasswordCredentials.password, "Password")}
                      className="h-12 w-12 border-2 border-amber-300"
                      data-testid="button-copy-reset-password"
                    >
                      {copiedField === "Password" ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-600 mt-1.5">Expires in 30 days</p>
                </div>
              </div>

              {/* Warning */}
              <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
                <div className="flex gap-3">
                  <div className="flex-shrink-0">
                    <span className="text-2xl">⚠️</span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-red-900">Important: Save These Credentials Now!</p>
                    <p className="text-sm text-red-800">
                      The password cannot be retrieved later. Make sure to copy and securely share these credentials with the business user.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                <Button 
                  onClick={() => {
                    setResetPasswordCredentials(null);
                    setNewTempPassword("");
                  }}
                  className="flex-1"
                  variant="outline"
                >
                  Reset Another Password
                </Button>
                <Button 
                  onClick={() => {
                    setIsResetPasswordDialogOpen(false);
                    setResetPasswordCredentials(null);
                    setNewTempPassword("");
                  }}
                  className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600"
                >
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => {
              e.preventDefault();
              if (selectedUserId && newTempPassword.trim()) {
                resetPasswordMutation.mutate({
                  userId: selectedUserId,
                  password: newTempPassword.trim(),
                });
              }
            }} className="space-y-4">
              <div>
                <Label htmlFor="newTempPassword">New Temporary Password</Label>
                <Input
                  id="newTempPassword"
                  type="password"
                  placeholder="Enter new temporary password"
                  value={newTempPassword}
                  onChange={(e) => setNewTempPassword(e.target.value)}
                  required
                  data-testid="input-new-temp-password"
                  className="mt-1.5"
                />
                <p className="text-xs text-gray-600 mt-1.5">This password will expire in 30 days</p>
              </div>
              <Button 
                type="submit" 
                disabled={resetPasswordMutation.isPending} 
                data-testid="button-submit-reset-password" 
                className="w-full"
              >
                {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
