import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Plus, Link2, Unlink, Trash2, Building2, Crown, Search, X, Check, Shield, BarChart3, Users, MessageSquare, Contact, Package, FileQuestion, Calendar, KeyRound, Clock, GraduationCap, RefreshCw, ChevronDown, ChevronRight, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import type { BusinessAccountDto } from "@shared/dto/businessAccount";

type DateFilterType = "today" | "yesterday" | "last7days" | "currentMonth" | "lastMonth" | "custom" | "lifetime";

interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface GroupInsights {
  groupId: string;
  groupName: string;
  dateFrom?: string;
  dateTo?: string;
  totals: {
    leads: number;
    conversations: number;
    visitors: number;
    products: number;
    faqs: number;
  };
  accountBreakdown: {
    businessAccountId: string;
    businessName: string;
    leads: number;
    conversations: number;
    visitors: number;
    products: number;
    faqs: number;
  }[];
}

const dateFilterOptions: { value: DateFilterType; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7days", label: "Last 7 Days" },
  { value: "currentMonth", label: "Current Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "custom", label: "Custom Range" },
  { value: "lifetime", label: "Lifetime" },
];

function getDateRangeForFilter(filterType: DateFilterType): DateRange {
  const now = new Date();
  switch (filterType) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday":
      const yesterday = subDays(now, 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    case "last7days":
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "currentMonth":
      return { from: startOfMonth(now), to: endOfDay(now) };
    case "lastMonth":
      const lastMonth = subMonths(now, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    case "lifetime":
    default:
      return { from: undefined, to: undefined };
  }
}

interface AccountGroupMember {
  businessAccountId: string;
  businessName: string;
  isPrimary: boolean;
}

interface AccountGroup {
  id: string;
  name: string;
  ownerUserId: string;
  primaryHasFullAccess: boolean;
  createdAt: string;
  members: AccountGroupMember[];
}

interface GroupAdmin {
  userId: string;
  username: string;
  canViewConversations: boolean;
  canViewLeads: boolean;
  canViewAnalytics: boolean;
  canExportData: boolean;
  assignedAt: string;
  userCreatedAt: string;
  lastLoginAt: string | null;
}

interface GroupAdminUser {
  id: string;
  username: string;
}

export default function SuperAdminAccountGroups() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<AccountGroup | null>(null);
  
  const [groupName, setGroupName] = useState("");
  const [primaryAccountId, setPrimaryAccountId] = useState("");
  const [memberAccountIds, setMemberAccountIds] = useState<string[]>([]);
  const [newMemberId, setNewMemberId] = useState("");
  const [primarySearch, setPrimarySearch] = useState("");
  const [additionalSearch, setAdditionalSearch] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<AccountGroup | null>(null);
  const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
  const [memberToUnlink, setMemberToUnlink] = useState<{ groupId: string; accountId: string; accountName: string } | null>(null);
  const [makePrimaryDialogOpen, setMakePrimaryDialogOpen] = useState(false);
  const [memberToMakePrimary, setMemberToMakePrimary] = useState<{ groupId: string; accountId: string; accountName: string } | null>(null);
  const [isAdminsDialogOpen, setIsAdminsDialogOpen] = useState(false);
  const [adminsGroup, setAdminsGroup] = useState<AccountGroup | null>(null);
  const [isAddAdminDialogOpen, setIsAddAdminDialogOpen] = useState(false);
  const [newAdminUserId, setNewAdminUserId] = useState("");
  const [newAdminPerms, setNewAdminPerms] = useState({ conversations: true, leads: true, analytics: true, export: false });
  const [isCreateAdminUserDialogOpen, setIsCreateAdminUserDialogOpen] = useState(false);
  const [newAdminUsername, setNewAdminUsername] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [createdAdminCredentials, setCreatedAdminCredentials] = useState<{ username: string; tempPassword: string } | null>(null);
  const [resetPasswordAdmin, setResetPasswordAdmin] = useState<{ userId: string; username: string } | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncGroup, setSyncGroup] = useState<AccountGroup | null>(null);
  const [syncFilter, setSyncFilter] = useState<'today' | 'yesterday' | 'last3days' | 'last7days'>('today');
  const [syncResults, setSyncResults] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  const { data: accountGroups = [], isLoading: groupsLoading } = useQuery<AccountGroup[]>({
    queryKey: ["/api/super-admin/account-groups"],
  });

  const { data: businessAccounts = [] } = useQuery<BusinessAccountDto[]>({
    queryKey: ["/api/business-accounts", "all"],
    queryFn: async () => {
      const data = await apiRequest("GET", "/api/business-accounts?limit=1000");
      // API returns { accounts: [...], total, hasMore } - extract accounts array
      return (data as any).accounts || data;
    },
  });

  const { data: unsyncedData, isLoading: unsyncedLoading, refetch: refetchUnsynced } = useQuery({
    queryKey: ["/api/super-admin/account-groups", syncGroup?.id, "unsynced-leads", syncFilter],
    queryFn: async () => {
      if (!syncGroup) return null;
      return await apiRequest("GET", `/api/super-admin/account-groups/${syncGroup.id}/leadsquared/unsynced-leads?filter=${syncFilter}`);
    },
    enabled: syncDialogOpen && !!syncGroup,
  });

  const handleSyncUnsynced = async () => {
    if (!syncGroup) return;
    setIsSyncing(true);
    setSyncResults(null);
    try {
      const result = await apiRequest("POST", `/api/super-admin/account-groups/${syncGroup.id}/leadsquared/sync-unsynced`, { filter: syncFilter });
      setSyncResults(result);
      refetchUnsynced();
      toast({
        title: "Sync completed",
        description: `${(result as any).totalSynced} synced, ${(result as any).totalFailed} failed`,
      });
    } catch (error: any) {
      toast({
        title: "Sync failed",
        description: error.message || "Failed to sync leads",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const openSyncDialog = (group: AccountGroup) => {
    setSyncGroup(group);
    setSyncFilter('today');
    setSyncResults(null);
    setExpandedAccounts(new Set());
    setSyncDialogOpen(true);
  };

  const toggleAccountExpand = (accountId: string) => {
    setExpandedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const navigateToInsights = (group: AccountGroup) => {
    setLocation(`/super-admin/account-groups/${group.id}/insights`);
  };

  const linkedAccountIds = new Set(
    accountGroups.flatMap(g => g.members.map(m => m.businessAccountId))
  );

  const availableAccounts = businessAccounts.filter(
    account => !linkedAccountIds.has(account.id)
  );

  const createGroupMutation = useMutation({
    mutationFn: async (data: { name: string; primaryAccountId: string; memberAccountIds: string[] }) => {
      return await apiRequest<AccountGroup>("POST", "/api/super-admin/account-groups", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/account-groups"] });
      setIsCreateDialogOpen(false);
      resetForm();
      toast({
        title: "Account Group Created",
        description: "The accounts have been linked successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async (data: { groupId: string; businessAccountId: string }) => {
      return await apiRequest<AccountGroup>(
        "POST",
        `/api/super-admin/account-groups/${data.groupId}/members`,
        { businessAccountId: data.businessAccountId }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/account-groups"] });
      setIsAddMemberDialogOpen(false);
      setNewMemberId("");
      toast({
        title: "Account Linked",
        description: "The account has been added to the group",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (data: { groupId: string; accountId: string }) => {
      return await apiRequest<AccountGroup>(
        "DELETE",
        `/api/super-admin/account-groups/${data.groupId}/members/${data.accountId}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/account-groups"] });
      toast({
        title: "Account Unlinked",
        description: "The account has been removed from the group",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      return await apiRequest<{ success: boolean }>(
        "DELETE",
        `/api/super-admin/account-groups/${groupId}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/account-groups"] });
      toast({
        title: "Group Deleted",
        description: "All accounts have been unlinked",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: async (data: { groupId: string; primaryHasFullAccess: boolean }) => {
      return await apiRequest<AccountGroup>(
        "PATCH",
        `/api/super-admin/account-groups/${data.groupId}`,
        { primaryHasFullAccess: data.primaryHasFullAccess }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/account-groups"] });
      toast({
        title: "Settings Updated",
        description: "Primary account access setting has been updated",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (data: { groupId: string; businessAccountId: string }) => {
      return await apiRequest<AccountGroup>(
        "PATCH",
        `/api/super-admin/account-groups/${data.groupId}/primary`,
        { businessAccountId: data.businessAccountId }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/account-groups"] });
      toast({
        title: "Primary Account Changed",
        description: "The primary account has been updated",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: groupAdmins = [], refetch: refetchAdmins } = useQuery<GroupAdmin[]>({
    queryKey: ["/api/super-admin/account-groups", adminsGroup?.id, "admins"],
    queryFn: async () => {
      if (!adminsGroup) return [];
      const res = await fetch(`/api/super-admin/account-groups/${adminsGroup.id}/admins`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch admins");
      const data = await res.json();
      return data.admins || [];
    },
    enabled: !!adminsGroup,
  });

  const { data: groupAdminUsers = [] } = useQuery<GroupAdminUser[]>({
    queryKey: ["/api/super-admin/group-admin-users"],
    queryFn: async () => {
      const res = await fetch("/api/super-admin/group-admin-users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      const data = await res.json();
      return data.users || [];
    },
  });

  const addGroupAdminMutation = useMutation({
    mutationFn: async (data: { groupId: string; userId: string; canViewConversations: boolean; canViewLeads: boolean; canViewAnalytics: boolean; canExportData: boolean }) => {
      return await apiRequest("POST", `/api/super-admin/account-groups/${data.groupId}/admins`, {
        userId: data.userId,
        canViewConversations: data.canViewConversations,
        canViewLeads: data.canViewLeads,
        canViewAnalytics: data.canViewAnalytics,
        canExportData: data.canExportData,
      });
    },
    onSuccess: () => {
      refetchAdmins();
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/group-admin-users"] });
      setIsAddAdminDialogOpen(false);
      setNewAdminUserId("");
      setNewAdminPerms({ conversations: true, leads: true, analytics: true, export: false });
      toast({ title: "Admin Added", description: "User has been assigned as group admin" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const removeGroupAdminMutation = useMutation({
    mutationFn: async (data: { groupId: string; userId: string }) => {
      return await apiRequest("DELETE", `/api/super-admin/account-groups/${data.groupId}/admins/${data.userId}`);
    },
    onSuccess: () => {
      refetchAdmins();
      toast({ title: "Admin Removed", description: "User has been removed as group admin" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateGroupAdminMutation = useMutation({
    mutationFn: async (data: { groupId: string; userId: string; canViewConversations: boolean; canViewLeads: boolean; canViewAnalytics: boolean; canExportData: boolean }) => {
      return await apiRequest("PUT", `/api/super-admin/account-groups/${data.groupId}/admins/${data.userId}`, {
        canViewConversations: data.canViewConversations,
        canViewLeads: data.canViewLeads,
        canViewAnalytics: data.canViewAnalytics,
        canExportData: data.canExportData,
      });
    },
    onSuccess: () => {
      refetchAdmins();
      toast({ title: "Permissions Updated", description: "Admin permissions have been updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createGroupAdminUserMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      return await apiRequest<{ success: boolean; user: { id: string; username: string }; tempPassword: string }>("POST", "/api/super-admin/group-admin-users", data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/group-admin-users"] });
      setIsCreateAdminUserDialogOpen(false);
      setNewAdminUsername("");
      setNewAdminPassword("");
      setCreatedAdminCredentials({ username: data.user.username, tempPassword: data.tempPassword });
      toast({ title: "User Created", description: `Group admin user "${data.user.username}" created successfully` });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (data: { userId: string; newPassword: string }) => {
      return await apiRequest<{ success: boolean; username: string }>("POST", `/api/super-admin/group-admin-users/${data.userId}/reset-password`, { newPassword: data.newPassword });
    },
    onSuccess: (data) => {
      setResetPasswordAdmin(null);
      setResetPassword("");
      toast({ title: "Password Reset", description: `Password for "${data.username}" has been reset. They will need to change it on next login.` });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openAdminsDialog = (group: AccountGroup) => {
    setAdminsGroup(group);
    setIsAdminsDialogOpen(true);
  };

  const resetForm = () => {
    setGroupName("");
    setPrimaryAccountId("");
    setMemberAccountIds([]);
    setPrimarySearch("");
    setAdditionalSearch("");
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim() || !primaryAccountId) {
      toast({
        title: "Missing Information",
        description: "Please provide a group name and select a primary account",
        variant: "destructive",
      });
      return;
    }
    createGroupMutation.mutate({
      name: groupName.trim(),
      primaryAccountId,
      memberAccountIds,
    });
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !newMemberId) return;
    addMemberMutation.mutate({
      groupId: selectedGroup.id,
      businessAccountId: newMemberId,
    });
  };

  const openAddMemberDialog = (group: AccountGroup) => {
    setSelectedGroup(group);
    setNewMemberId("");
    setIsAddMemberDialogOpen(true);
  };

  const availableForNewMember = selectedGroup
    ? businessAccounts.filter(
        account =>
          !linkedAccountIds.has(account.id) ||
          selectedGroup.members.some(m => m.businessAccountId === account.id)
      ).filter(account => !selectedGroup.members.some(m => m.businessAccountId === account.id))
    : [];

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center gap-3 px-6 py-4 border-b bg-gradient-to-r from-[hsl(var(--gradient-start))] to-[hsl(var(--gradient-end))]">
        <SidebarTrigger className="text-white hover:bg-white/10" />
        <div className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-white" />
          <h1 className="text-lg font-semibold text-white">Account Groups</h1>
        </div>
        <div className="ml-auto">
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Create Group
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Create Account Group</DialogTitle>
                <DialogDescription>
                  Link multiple business accounts together so users can switch between them.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateGroup}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="groupName">Group Name</Label>
                    <Input
                      id="groupName"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="e.g., Enterprise Holdings"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="primaryAccount">Primary Account</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search accounts..."
                        value={primarySearch}
                        onChange={(e) => setPrimarySearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    {primaryAccountId && (
                      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-md border border-primary/20">
                        <Building2 className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium flex-1">
                          {availableAccounts.find(a => a.id === primaryAccountId)?.name}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => setPrimaryAccountId("")}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                    {!primaryAccountId && primarySearch && (
                      <div className="max-h-32 overflow-y-auto border rounded-md">
                        {availableAccounts
                          .filter(a => a.name.toLowerCase().includes(primarySearch.toLowerCase()))
                          .slice(0, 5)
                          .map((account) => (
                            <div
                              key={account.id}
                              className="flex items-center gap-2 p-2 hover:bg-muted cursor-pointer"
                              onClick={() => {
                                setPrimaryAccountId(account.id);
                                setPrimarySearch("");
                              }}
                            >
                              <Building2 className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm">{account.name}</span>
                            </div>
                          ))}
                        {availableAccounts.filter(a => a.name.toLowerCase().includes(primarySearch.toLowerCase())).length === 0 && (
                          <div className="p-2 text-sm text-muted-foreground">No accounts found</div>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      The primary account owner will manage the group
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Additional Accounts (Optional)</Label>
                    {memberAccountIds.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {memberAccountIds.map((id) => {
                          const account = availableAccounts.find(a => a.id === id);
                          return account ? (
                            <Badge key={id} variant="secondary" className="flex items-center gap-1">
                              {account.name}
                              <X
                                className="w-3 h-3 cursor-pointer hover:text-destructive"
                                onClick={() => setMemberAccountIds(prev => prev.filter(i => i !== id))}
                              />
                            </Badge>
                          ) : null;
                        })}
                      </div>
                    )}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search to add accounts..."
                        value={additionalSearch}
                        onChange={(e) => setAdditionalSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    {additionalSearch && (
                      <div className="max-h-32 overflow-y-auto border rounded-md">
                        {availableAccounts
                          .filter(a => a.id !== primaryAccountId && !memberAccountIds.includes(a.id))
                          .filter(a => a.name.toLowerCase().includes(additionalSearch.toLowerCase()))
                          .slice(0, 5)
                          .map((account) => (
                            <div
                              key={account.id}
                              className="flex items-center gap-2 p-2 hover:bg-muted cursor-pointer"
                              onClick={() => {
                                setMemberAccountIds(prev => [...prev, account.id]);
                                setAdditionalSearch("");
                              }}
                            >
                              <Building2 className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm">{account.name}</span>
                              <Check className="w-3 h-3 ml-auto text-primary" />
                            </div>
                          ))}
                        {availableAccounts
                          .filter(a => a.id !== primaryAccountId && !memberAccountIds.includes(a.id))
                          .filter(a => a.name.toLowerCase().includes(additionalSearch.toLowerCase())).length === 0 && (
                          <div className="p-2 text-sm text-muted-foreground">No accounts found</div>
                        )}
                      </div>
                    )}
                    {availableAccounts.filter(a => a.id !== primaryAccountId).length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No additional accounts available to link
                      </p>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createGroupMutation.isPending}>
                    {createGroupMutation.isPending ? "Creating..." : "Create Group"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        {groupsLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Loading account groups...</p>
          </div>
        ) : accountGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <Link2 className="w-12 h-12 text-muted-foreground/50" />
            <h2 className="text-lg font-medium">No Account Groups</h2>
            <p className="text-muted-foreground text-center max-w-md">
              Create account groups to allow users to manage multiple business accounts from a single login.
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Group
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {accountGroups.map((group) => (
              <Card key={group.id} className="relative flex flex-col h-[400px]">
                <CardHeader className="pb-3 flex-shrink-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{group.name}</CardTitle>
                      <CardDescription>
                        {group.members.length} linked account{group.members.length !== 1 ? 's' : ''}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-primary hover:bg-primary/10"
                        title="View Insights"
                        onClick={() => navigateToInsights(group)}
                      >
                        <BarChart3 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-indigo-600 hover:bg-indigo-50"
                        title="Manage Group Admins"
                        onClick={() => openAdminsDialog(group)}
                      >
                        <Users className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-amber-600 hover:bg-amber-50"
                        title="Group Training"
                        onClick={() => setLocation(`/super-admin/account-groups/${group.id}/training`)}
                      >
                        <GraduationCap className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-green-600 hover:bg-green-50"
                        title="Sync Unsynced Leads to LeadSquared"
                        onClick={() => openSyncDialog(group)}
                      >
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          setGroupToDelete(group);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col overflow-hidden">
                  <div className="space-y-2 overflow-y-auto flex-1 pr-1">
                    {group.members.map((member) => (
                      <div
                        key={member.businessAccountId}
                        className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                      >
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{member.businessName}</span>
                          {member.isPrimary && (
                            <Badge variant="secondary" className="text-xs">
                              <Crown className="w-3 h-3 mr-1" />
                              Primary
                            </Badge>
                          )}
                        </div>
                        {!member.isPrimary && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-amber-600"
                              title="Make Primary"
                              onClick={() => {
                                setMemberToMakePrimary({
                                  groupId: group.id,
                                  accountId: member.businessAccountId,
                                  accountName: member.businessName,
                                });
                                setMakePrimaryDialogOpen(true);
                              }}
                              disabled={setPrimaryMutation.isPending}
                            >
                              <Crown className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Unlink"
                              onClick={() => {
                                setMemberToUnlink({
                                  groupId: group.id,
                                  accountId: member.businessAccountId,
                                  accountName: member.businessName,
                                });
                                setUnlinkDialogOpen(true);
                              }}
                              disabled={removeMemberMutation.isPending}
                            >
                              <Unlink className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex-shrink-0 mt-4 space-y-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => openAddMemberDialog(group)}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Account
                    </Button>
                    <div className="flex items-center justify-between pt-4 border-t">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Primary has full access</span>
                    </div>
                    <Switch
                      checked={group.primaryHasFullAccess}
                      onCheckedChange={(checked) => {
                        updateGroupMutation.mutate({
                          groupId: group.id,
                          primaryHasFullAccess: checked,
                        });
                      }}
                      disabled={updateGroupMutation.isPending}
                    />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Dialog open={isAddMemberDialogOpen} onOpenChange={setIsAddMemberDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Account to Group</DialogTitle>
            <DialogDescription>
              Select an account to link to "{selectedGroup?.name}"
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddMember}>
            <div className="py-4">
              <Select value={newMemberId} onValueChange={setNewMemberId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account to add" />
                </SelectTrigger>
                <SelectContent>
                  {availableForNewMember.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableForNewMember.length === 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  No available accounts to add. All accounts are already linked.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddMemberDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={!newMemberId || addMemberMutation.isPending}
              >
                {addMemberMutation.isPending ? "Adding..." : "Add Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Account Group</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{groupToDelete?.name}"? All {groupToDelete?.members.length || 0} linked accounts will be unlinked. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setGroupToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (groupToDelete) {
                  deleteGroupMutation.mutate(groupToDelete.id);
                  setDeleteDialogOpen(false);
                  setGroupToDelete(null);
                }
              }}
            >
              Delete Group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={unlinkDialogOpen} onOpenChange={setUnlinkDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to unlink "{memberToUnlink?.accountName}" from this group?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMemberToUnlink(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (memberToUnlink) {
                  removeMemberMutation.mutate({
                    groupId: memberToUnlink.groupId,
                    accountId: memberToUnlink.accountId,
                  });
                  setUnlinkDialogOpen(false);
                  setMemberToUnlink(null);
                }
              }}
            >
              Unlink
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={makePrimaryDialogOpen} onOpenChange={setMakePrimaryDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make Primary Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to make "{memberToMakePrimary?.accountName}" the primary account for this group?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMemberToMakePrimary(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (memberToMakePrimary) {
                  setPrimaryMutation.mutate({
                    groupId: memberToMakePrimary.groupId,
                    businessAccountId: memberToMakePrimary.accountId,
                  });
                  setMakePrimaryDialogOpen(false);
                  setMemberToMakePrimary(null);
                }
              }}
            >
              Make Primary
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isAdminsDialogOpen} onOpenChange={setIsAdminsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Group Admins - {adminsGroup?.name}</DialogTitle>
            <DialogDescription>
              Manage users who can view data across this group's accounts
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h4 className="font-medium">Assigned Admins</h4>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setIsCreateAdminUserDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Create User
                </Button>
                <Button size="sm" onClick={() => setIsAddAdminDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Add Admin
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[300px]">
              {groupAdmins.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No admins assigned to this group yet
                </div>
              ) : (
                <div className="space-y-3">
                  {groupAdmins.map(admin => (
                    <Card key={admin.userId}>
                      <CardContent className="py-3 px-4">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium flex items-center gap-2">
                              <Shield className="w-4 h-4" />
                              {admin.username}
                            </div>
                            <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                Created: {admin.userCreatedAt ? format(new Date(admin.userCreatedAt), "MMM d, yyyy") : "N/A"}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Last login: {admin.lastLoginAt ? format(new Date(admin.lastLoginAt), "MMM d, yyyy h:mm a") : "Never"}
                              </span>
                            </div>
                            <div className="flex gap-2 mt-2 flex-wrap">
                              {admin.canViewConversations && <Badge variant="secondary">Conversations</Badge>}
                              {admin.canViewLeads && <Badge variant="secondary">Leads</Badge>}
                              {admin.canViewAnalytics && <Badge variant="secondary">Analytics</Badge>}
                              {admin.canExportData && <Badge variant="secondary">Export</Badge>}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Reset Password"
                              onClick={() => setResetPasswordAdmin({ userId: admin.userId, username: admin.username })}
                            >
                              <KeyRound className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              title="Remove Admin"
                              onClick={() => {
                                if (adminsGroup) {
                                  removeGroupAdminMutation.mutate({ groupId: adminsGroup.id, userId: admin.userId });
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAdminsDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAddAdminDialogOpen} onOpenChange={setIsAddAdminDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Group Admin</DialogTitle>
            <DialogDescription>
              Select a user to assign as admin for this group
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Select User</Label>
              <Select value={newAdminUserId} onValueChange={setNewAdminUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a user..." />
                </SelectTrigger>
                <SelectContent>
                  {groupAdminUsers
                    .filter(u => !groupAdmins.some(a => a.userId === u.id))
                    .map(user => (
                      <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {groupAdminUsers.filter(u => !groupAdmins.some(a => a.userId === u.id)).length === 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  No available users. Create a new group admin user first.
                </p>
              )}
            </div>
            <div className="space-y-3">
              <Label>Permissions</Label>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">View Conversations</span>
                  <Switch checked={newAdminPerms.conversations} onCheckedChange={v => setNewAdminPerms(p => ({ ...p, conversations: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">View Leads</span>
                  <Switch checked={newAdminPerms.leads} onCheckedChange={v => setNewAdminPerms(p => ({ ...p, leads: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">View Analytics</span>
                  <Switch checked={newAdminPerms.analytics} onCheckedChange={v => setNewAdminPerms(p => ({ ...p, analytics: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Export Data</span>
                  <Switch checked={newAdminPerms.export} onCheckedChange={v => setNewAdminPerms(p => ({ ...p, export: v }))} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddAdminDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!newAdminUserId || addGroupAdminMutation.isPending}
              onClick={() => {
                if (adminsGroup && newAdminUserId) {
                  addGroupAdminMutation.mutate({
                    groupId: adminsGroup.id,
                    userId: newAdminUserId,
                    canViewConversations: newAdminPerms.conversations,
                    canViewLeads: newAdminPerms.leads,
                    canViewAnalytics: newAdminPerms.analytics,
                    canExportData: newAdminPerms.export,
                  });
                }
              }}
            >
              Add Admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateAdminUserDialogOpen} onOpenChange={setIsCreateAdminUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Group Admin User</DialogTitle>
            <DialogDescription>
              Create a new user account with the Group Admin role
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="admin-username">Username</Label>
              <Input
                id="admin-username"
                value={newAdminUsername}
                onChange={e => setNewAdminUsername(e.target.value)}
                placeholder="Enter username"
              />
            </div>
            <div>
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                value={newAdminPassword}
                onChange={e => setNewAdminPassword(e.target.value)}
                placeholder="Enter password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateAdminUserDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!newAdminUsername || !newAdminPassword || createGroupAdminUserMutation.isPending}
              onClick={() => createGroupAdminUserMutation.mutate({ username: newAdminUsername, password: newAdminPassword })}
            >
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdAdminCredentials} onOpenChange={() => setCreatedAdminCredentials(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>User Created Successfully</DialogTitle>
            <DialogDescription>
              Save these credentials - they won't be shown again
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 bg-muted p-4 rounded-lg">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Username:</span>
              <span className="font-mono font-medium">{createdAdminCredentials?.username}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Password:</span>
              <span className="font-mono font-medium">{createdAdminCredentials?.tempPassword}</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            The user will be required to change their password on first login.
          </p>
          <DialogFooter>
            <Button onClick={() => setCreatedAdminCredentials(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetPasswordAdmin} onOpenChange={() => { setResetPasswordAdmin(null); setResetPassword(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for {resetPasswordAdmin?.username}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                placeholder="Enter new password (min 6 characters)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetPasswordAdmin(null); setResetPassword(""); }}>Cancel</Button>
            <Button
              disabled={!resetPassword || resetPassword.length < 6 || resetPasswordMutation.isPending}
              onClick={() => {
                if (resetPasswordAdmin) {
                  resetPasswordMutation.mutate({ userId: resetPasswordAdmin.userId, newPassword: resetPassword });
                }
              }}
            >
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={syncDialogOpen} onOpenChange={(open) => { setSyncDialogOpen(open); if (!open) { setSyncGroup(null); setSyncResults(null); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Sync Unsynced Leads to LeadSquared</DialogTitle>
            <DialogDescription>
              {syncGroup?.name} — Find and sync leads that haven't been synced to LeadSquared
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 flex-wrap">
            {([
              { value: 'today', label: 'Today' },
              { value: 'yesterday', label: 'Yesterday' },
              { value: 'last3days', label: 'Last 3 Days' },
              { value: 'last7days', label: 'Last 7 Days' },
            ] as const).map(opt => (
              <Button
                key={opt.value}
                variant={syncFilter === opt.value ? "default" : "outline"}
                size="sm"
                onClick={() => { setSyncFilter(opt.value); setSyncResults(null); }}
              >
                {opt.label}
              </Button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
            {unsyncedLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin mr-2 text-muted-foreground" />
                <span className="text-muted-foreground">Loading unsynced leads...</span>
              </div>
            ) : (unsyncedData as any)?.totalUnsynced === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
                <p>All leads are synced for this period</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-2 py-1 bg-muted/50 rounded-md">
                  <span className="text-sm font-medium">Total unsynced: {(unsyncedData as any)?.totalUnsynced || 0}</span>
                </div>
                {(unsyncedData as any)?.accounts?.map((account: any) => (
                  <div key={account.businessAccountId} className="border rounded-md">
                    <button
                      className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                      onClick={() => toggleAccountExpand(account.businessAccountId)}
                    >
                      <div className="flex items-center gap-2">
                        {expandedAccounts.has(account.businessAccountId) ? (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        )}
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{account.accountName}</span>
                      </div>
                      <Badge variant={account.unsyncedCount > 0 ? "destructive" : "secondary"} className="text-xs">
                        {account.unsyncedCount} unsynced
                      </Badge>
                    </button>
                    {expandedAccounts.has(account.businessAccountId) && account.leads.length > 0 && (
                      <div className="border-t px-3 pb-3">
                        <div className="space-y-1 mt-2">
                          {account.leads.map((lead: any) => (
                            <div key={lead.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-muted/30">
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <span className="font-medium truncate max-w-[120px]">{lead.name || '—'}</span>
                                <span className="text-muted-foreground truncate max-w-[150px]">{lead.email || '—'}</span>
                                <span className="text-muted-foreground">{lead.phone || '—'}</span>
                              </div>
                              <div className="flex items-center gap-2 ml-2 shrink-0">
                                {lead.syncStatus === 'permanently_failed' && (
                                  <span className="text-destructive flex items-center gap-1" title={lead.syncError || ''}>
                                    <AlertCircle className="w-3 h-3" /> Failed ({lead.retryCount}/3)
                                  </span>
                                )}
                                {lead.syncStatus === 'failed' && (
                                  <span className="text-amber-600 flex items-center gap-1" title={lead.syncError || ''}>
                                    <AlertCircle className="w-3 h-3" /> Retrying ({lead.retryCount}/3)
                                  </span>
                                )}
                                {lead.syncStatus === 'pending' && (
                                  <span className="text-amber-600">Pending</span>
                                )}
                                {!lead.syncStatus && (
                                  <span className="text-muted-foreground">Not synced</span>
                                )}
                                <span className="text-muted-foreground">
                                  {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : ''}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {syncResults && (() => {
                      const accountResult = syncResults.accounts?.find((a: any) => a.businessAccountId === account.businessAccountId);
                      if (!accountResult || (accountResult.synced === 0 && accountResult.failed === 0 && accountResult.errors.length === 0)) return null;
                      return (
                        <div className="border-t px-3 py-2 bg-muted/20">
                          <div className="flex items-center gap-3 text-xs">
                            {accountResult.synced > 0 && (
                              <span className="text-green-600 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> {accountResult.synced} synced
                              </span>
                            )}
                            {accountResult.failed > 0 && (
                              <span className="text-destructive flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" /> {accountResult.failed} failed
                              </span>
                            )}
                            {accountResult.errors.length > 0 && accountResult.synced === 0 && accountResult.failed === 0 && (
                              <span className="text-muted-foreground">{accountResult.errors[0]}</span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncDialogOpen(false)}>Close</Button>
            <Button
              disabled={isSyncing || unsyncedLoading || (unsyncedData as any)?.totalUnsynced === 0}
              onClick={handleSyncUnsynced}
            >
              {isSyncing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                `Sync All (${(unsyncedData as any)?.totalUnsynced || 0})`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
