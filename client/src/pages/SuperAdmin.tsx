import { useState, useEffect, useRef } from "react";
import { useMutation, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AccountPage, FeatureChips } from "@/components/superadmin/AccountPage";
import type { SummaryResponse } from "@/pages/SuperAdminUsage";
import { accountHref } from "@/navigation/superAdminAreas";
import { currentIstMonth, formatUsd, monthLabel } from "@/components/usage/usageFormat";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { DataRetentionDialog } from "@/components/DataRetentionDialog";
import { LiveAvatarSettingsDialog } from "@/components/LiveAvatarSettingsDialog";
import { Plus, Timer, Building2, Pencil, Copy, Check, Sparkles, MoreVertical, Eye, Search, Trash2, Gem, Power, LogIn, Play, MessageCircle, MessageSquare, Video } from "lucide-react";
import type { BusinessAccountDto, ProductTier } from "@shared/dto/businessAccount";
import AccountFeaturesSettings from "@/pages/settings/AccountFeaturesSettings";

/** Business accounts: the list, or (with accountId) one account's own page. Both share the dialogs below. */
export default function SuperAdmin({ accountId, tab }: { accountId?: string; tab?: string } = {}) {
  const [, setLocation] = useLocation();
  const [listFilter, setListFilter] = useState<"all" | "live" | "disabled" | "over">("all");
  const [retentionAccount, setRetentionAccount] = useState<{ id: string; name: string } | null>(null);
  const [avatarAccount, setAvatarAccount] = useState<{ id: string; name: string } | null>(null);
  const [newBusinessName, setNewBusinessName] = useState("");
  const [newBusinessWebsite, setNewBusinessWebsite] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newProductTier, setNewProductTier] = useState<ProductTier>("chroney");
  const [newChroneyEnabled, setNewChroneyEnabled] = useState(true);
  const [newWhatsappEnabled, setNewWhatsappEnabled] = useState(false);
  const [newJewelryEnabled, setNewJewelryEnabled] = useState(false);
  const [isBusinessDialogOpen, setIsBusinessDialogOpen] = useState(false);
  
  const [editingBusiness, setEditingBusiness] = useState<BusinessAccountDto | null>(null);
  const [editBusinessName, setEditBusinessName] = useState("");
  const [editBusinessWebsite, setEditBusinessWebsite] = useState("");
  const [editProductTier, setEditProductTier] = useState<ProductTier>("chroney");
  const [editChroneyEnabled, setEditChroneyEnabled] = useState(true);
  const [editWhatsappEnabled, setEditWhatsappEnabled] = useState(false);
  const [editJewelryEnabled, setEditJewelryEnabled] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
  const [credentialsDialogOpen, setCredentialsDialogOpen] = useState(false);
  const [generatedCredentials, setGeneratedCredentials] = useState<{ username: string; tempPassword: string } | null>(null);
  
  const [viewPasswordBusiness, setViewPasswordBusiness] = useState<BusinessAccountDto | null>(null);
  const [viewPasswordDialogOpen, setViewPasswordDialogOpen] = useState(false);
  const [viewPasswordData, setViewPasswordData] = useState<{ username: string; tempPassword: string | null } | null>(null);
  const [copiedPassword, setCopiedPassword] = useState(false);
  
  const [featuresAccount, setFeaturesAccount] = useState<{ id: string; name: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [businessToDelete, setBusinessToDelete] = useState<BusinessAccountDto | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  
  
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [businessToDuplicate, setBusinessToDuplicate] = useState<BusinessAccountDto | null>(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicateWebsite, setDuplicateWebsite] = useState("");
  const [duplicateAdminName, setDuplicateAdminName] = useState("");
  const [duplicateAdminEmail, setDuplicateAdminEmail] = useState("");
  const [duplicateAdminPassword, setDuplicateAdminPassword] = useState("");
  const [duplicateOptions, setDuplicateOptions] = useState({
    copyProducts: true,
    copyFaqs: true,
    copyTrainingDocuments: true,
    copyConversationJourneys: true,
    copyScheduleTemplates: true,
    copyWidgetSettings: true,
  });
  
  const { toast } = useToast();
  const accountQuery = useQuery<BusinessAccountDto>({ queryKey: ["/api/business-accounts", accountId], enabled: !!accountId, retry: false });
  const usageMonth = currentIstMonth();
  const { data: usage } = useQuery<SummaryResponse>({
    queryKey: ["/api/super-admin/usage", usageMonth],
    queryFn: async () => {
      const res = await fetch(`/api/super-admin/usage?month=${usageMonth}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load usage");
      return res.json();
    },
    enabled: !accountId,
    staleTime: 60_000,
  });
  const usageById = new Map((usage?.accounts ?? []).map(r => [r.businessAccountId, r]));
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const ACCOUNTS_PER_PAGE = 30;

  // Fetch business accounts with infinite scroll
  interface BusinessAccountsResponse {
    accounts: BusinessAccountDto[];
    total: number;
    hasMore: boolean;
  }

  const {
    data: businessAccountsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingAccounts,
  } = useInfiniteQuery<BusinessAccountsResponse>({
    queryKey: ["/api/business-accounts", "paginated"],
    queryFn: async ({ pageParam = 0 }) => {
      const response = await fetch(`/api/business-accounts?limit=${ACCOUNTS_PER_PAGE}&offset=${pageParam}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch business accounts");
      return response.json();
    },
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      // Handle both new format and cached old format gracefully
      const accounts = lastPage?.accounts || [];
      // If we got fewer items than requested, there are no more pages
      if (accounts.length < ACCOUNTS_PER_PAGE) return undefined;
      // Otherwise, return the next offset
      return (lastPageParam as number) + accounts.length;
    },
    initialPageParam: 0,
  });

  // Flatten all pages into a single array
  const businessAccounts = businessAccountsData?.pages.flatMap(page => page.accounts) ?? [];
  const totalAccounts = businessAccountsData?.pages[0]?.total ?? 0;

  // IntersectionObserver for infinite scroll - triggers when sentinel element becomes visible
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // Create business account mutation
  const createBusinessMutation = useMutation({
    mutationFn: async (data: { name: string; website: string; username: string; productTier: ProductTier; chroneyEnabled: boolean; whatsappEnabled: boolean }) => {
      return await apiRequest<{ businessAccount: BusinessAccountDto; user: any; credentials: { username: string; tempPassword: string } }>("POST", "/api/business-accounts", data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts"] });
      setNewBusinessName("");
      setNewBusinessWebsite("");
      setNewUsername("");
      setNewProductTier("chroney");
      setNewChroneyEnabled(true);
      setNewWhatsappEnabled(false);
      setNewJewelryEnabled(false);
      setIsBusinessDialogOpen(false);
      setGeneratedCredentials(data.credentials);
      setCredentialsDialogOpen(true);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create business account",
        variant: "destructive",
      });
    },
  });

  const handleCreateBusiness = (e: React.FormEvent) => {
    e.preventDefault();
    if (newBusinessName.trim() && newBusinessWebsite.trim() && newUsername.trim()) {
      // Derive productTier from checkbox selections
      let productTier: ProductTier = "chroney";
      if (newChroneyEnabled && newJewelryEnabled) {
        productTier = "jewelry_showcase_chroney";
      } else if (newJewelryEnabled) {
        productTier = "jewelry_showcase";
      } else {
        productTier = "chroney";
      }
      
      createBusinessMutation.mutate({ 
        name: newBusinessName.trim(),
        website: newBusinessWebsite.trim(),
        username: newUsername.trim(),
        productTier,
        chroneyEnabled: newChroneyEnabled,
        whatsappEnabled: newWhatsappEnabled,
      });
    }
  };

  // Update business account mutation
  const updateBusinessMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; website: string; productTier: ProductTier; chroneyEnabled: boolean; whatsappEnabled: boolean }) => {
      return await apiRequest<BusinessAccountDto>("PUT", `/api/business-accounts/${data.id}`, {
        name: data.name,
        website: data.website,
        productTier: data.productTier,
        chroneyEnabled: data.chroneyEnabled,
        whatsappEnabled: data.whatsappEnabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts"] });
      setIsEditDialogOpen(false);
      setEditingBusiness(null);
      toast({
        title: "Success",
        description: "Business account updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update business account",
        variant: "destructive",
      });
    },
  });

  const handleEditBusiness = (business: BusinessAccountDto) => {
    setEditingBusiness(business);
    setEditBusinessName(business.name);
    setEditBusinessWebsite(business.website || "");
    setEditProductTier(business.productTier || "chroney");
    // Set checkbox values based on feature flags
    setEditChroneyEnabled(business.chroneyEnabled ?? true);
    setEditJewelryEnabled(business.productTier === "jewelry_showcase" || business.productTier === "jewelry_showcase_chroney");
    setEditWhatsappEnabled(business.whatsappEnabled || false);
    setIsEditDialogOpen(true);
  };

  const handleUpdateBusiness = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingBusiness && editBusinessName.trim() && editBusinessWebsite.trim()) {
      // Derive productTier from checkbox selections
      let productTier: ProductTier = "chroney";
      if (editChroneyEnabled && editJewelryEnabled) {
        productTier = "jewelry_showcase_chroney";
      } else if (editJewelryEnabled) {
        productTier = "jewelry_showcase";
      } else {
        productTier = "chroney";
      }
      
      updateBusinessMutation.mutate({
        id: editingBusiness.id,
        name: editBusinessName.trim(),
        website: editBusinessWebsite.trim(),
        productTier,
        chroneyEnabled: editChroneyEnabled,
        whatsappEnabled: editWhatsappEnabled,
      });
    }
  };

  // Toggle business account status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: async (data: { id: string; status: string }) => {
      return await apiRequest<BusinessAccountDto>("PATCH", `/api/business-accounts/${data.id}/status`, {
        status: data.status,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts"] });
      toast({
        title: "Success",
        description: `Business account ${variables.status === "active" ? "activated" : "suspended"} successfully`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update business account status",
        variant: "destructive",
      });
    },
  });

  const handleToggleStatus = (business: BusinessAccountDto) => {
    const newStatus = business.status === "active" ? "suspended" : "active";
    toggleStatusMutation.mutate({
      id: business.id,
      status: newStatus,
    });
  };

  // Impersonate business account mutation
  const impersonateMutation = useMutation({
    mutationFn: async (businessAccountId: string) => {
      return await apiRequest<{ success: boolean; message: string; impersonating: { businessAccountId: string; businessAccountName: string } }>(
        "POST", 
        `/api/super-admin/impersonate/${businessAccountId}`
      );
    },
    onSuccess: async () => {
      sessionStorage.removeItem("lastPath");
      // Anything already cached belongs to the previously viewed account. Refetching only the
      // identity queries leaves every other page rendering the old account's data under the
      // new account's banner, so clear the cache and reload for a clean slate — matching
      // AccountSwitcher, which already does this when it changes account.
      queryClient.clear();
      window.location.href = "/";
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to access account",
        variant: "destructive",
      });
    },
  });

  const handleImpersonate = (business: BusinessAccountDto) => {
    impersonateMutation.mutate(business.id);
  };
  // Reset password mutation (auto-generates new password)
  const resetPasswordMutation = useMutation({
    mutationFn: async (businessAccountId: string) => {
      return await apiRequest<{ username: string; tempPassword: string }>("POST", `/api/business-accounts/${businessAccountId}/reset-password`);
    },
    onSuccess: (data) => {
      setViewPasswordData(data);
      toast({
        title: "Password Reset Successfully",
        description: "A new temporary password has been generated",
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

  const handleResetPassword = () => {
    if (viewPasswordBusiness) {
      resetPasswordMutation.mutate(viewPasswordBusiness.id);
    }
  };

  // View password mutation
  const viewPasswordMutation = useMutation({
    mutationFn: async (businessAccountId: string) => {
      return await apiRequest<{ username: string; tempPassword: string | null }>("GET", `/api/business-accounts/${businessAccountId}/view-password`);
    },
    onSuccess: (data) => {
      setViewPasswordData(data);
      setViewPasswordDialogOpen(true);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to retrieve password",
        variant: "destructive",
      });
    },
  });

  const handleViewPassword = (business: BusinessAccountDto) => {
    setViewPasswordBusiness(business);
    setCopiedPassword(false);
    viewPasswordMutation.mutate(business.id);
  };

  const domainOf = (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  };

  // Everything an account gets (agents, add-ons, system mode) lives in one Features dialog.
  const openFeatures = (business: BusinessAccountDto) => setFeaturesAccount({ id: business.id, name: business.name });

  const duplicateAccountMutation = useMutation({
    mutationFn: async (data: { 
      sourceId: string; 
      name: string; 
      website: string; 
      adminName: string;
      adminEmail: string;
      adminPassword: string;
      options: typeof duplicateOptions 
    }) => {
      return await apiRequest<{ businessAccount: BusinessAccountDto; credentials: { username: string; tempPassword: string } }>(
        "POST", 
        `/api/business-accounts/${data.sourceId}/duplicate`,
        {
          name: data.name,
          website: data.website,
          adminName: data.adminName,
          adminEmail: data.adminEmail,
          adminPassword: data.adminPassword,
          options: data.options
        }
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts"] });
      setDuplicateDialogOpen(false);
      resetDuplicateForm();
      setGeneratedCredentials(data.credentials);
      setCredentialsDialogOpen(true);
      toast({
        title: "Account Duplicated",
        description: `${data.businessAccount.name} has been created successfully.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to duplicate account",
        variant: "destructive",
      });
    },
  });

  const handleDuplicateBusiness = (business: BusinessAccountDto) => {
    setBusinessToDuplicate(business);
    setDuplicateName(`${business.name} (Copy)`);
    setDuplicateWebsite(business.website || "");
    setDuplicateAdminName("");
    setDuplicateAdminEmail("");
    setDuplicateAdminPassword("");
    setDuplicateOptions({
      copyProducts: true,
      copyFaqs: true,
      copyTrainingDocuments: true,
      copyConversationJourneys: true,
      copyScheduleTemplates: true,
      copyWidgetSettings: true,
    });
    setDuplicateDialogOpen(true);
  };

  const resetDuplicateForm = () => {
    setBusinessToDuplicate(null);
    setDuplicateName("");
    setDuplicateWebsite("");
    setDuplicateAdminName("");
    setDuplicateAdminEmail("");
    setDuplicateAdminPassword("");
  };

  const handleDuplicateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (businessToDuplicate && duplicateName.trim() && duplicateAdminEmail.trim() && duplicateAdminPassword.trim()) {
      duplicateAccountMutation.mutate({
        sourceId: businessToDuplicate.id,
        name: duplicateName.trim(),
        website: duplicateWebsite.trim(),
        adminName: duplicateAdminName.trim(),
        adminEmail: duplicateAdminEmail.trim(),
        adminPassword: duplicateAdminPassword.trim(),
        options: duplicateOptions,
      });
    }
  };

  const handleCopyPassword = () => {
    if (viewPasswordData?.tempPassword) {
      navigator.clipboard.writeText(viewPasswordData.tempPassword);
      setCopiedPassword(true);
      toast({
        title: "Copied!",
        description: "Password copied to clipboard",
      });
      setTimeout(() => setCopiedPassword(false), 2000);
    }
  };

  const deleteBusinessMutation = useMutation({
    mutationFn: async (data: { id: string; password: string }) => {
      return await apiRequest("DELETE", `/api/business-accounts/${data.id}`, { password: data.password });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts"] });
      setDeleteDialogOpen(false);
      setBusinessToDelete(null);
      setDeletePassword("");
      setDeleteError("");
      if (accountId) setLocation("/super-admin");
      toast({
        title: "Business Account Deleted",
        description: "The business account and all associated data have been permanently deleted.",
      });
    },
    onError: (error: any) => {
      console.error("Delete error:", error);
      const errorMessage = error.message || "Failed to delete business account";
      setDeleteError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleDeleteBusiness = (business: BusinessAccountDto) => {
    setBusinessToDelete(business);
    setDeletePassword("");
    setDeleteError("");
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!businessToDelete || !deletePassword.trim()) {
      setDeleteError("Please enter your password to confirm deletion");
      return;
    }
    deleteBusinessMutation.mutate({ id: businessToDelete.id, password: deletePassword });
  };


  const visibleAccounts = businessAccounts.filter((business) => {
    const q = searchQuery.trim().toLowerCase();
    if (q && !business.name.toLowerCase().includes(q) && !(business.website || "").toLowerCase().includes(q)) return false;
    if (listFilter === "live") return !!business.isLive;
    if (listFilter === "disabled") return business.status !== "active";
    if (listFilter === "over") { const level = usageById.get(business.id)?.limit?.level; return level === "warn" || level === "exceeded"; }
    return true;
  });

  return (
    <>
      {accountId ? (
        <AccountPage
          accountId={accountId}
          tab={tab}
          account={accountQuery.data}
          isLoading={accountQuery.isLoading}
          isError={accountQuery.isError}
          actions={{
            openPortal: () => { if (accountQuery.data) handleImpersonate(accountQuery.data); },
            openingPortal: impersonateMutation.isPending,
            openFeatures: () => { if (accountQuery.data) openFeatures(accountQuery.data); },
            edit: () => { if (accountQuery.data) handleEditBusiness(accountQuery.data); },
            credentials: () => { if (accountQuery.data) handleViewPassword(accountQuery.data); },
            toggleStatus: () => { if (accountQuery.data) handleToggleStatus(accountQuery.data); },
            togglingStatus: toggleStatusMutation.isPending,
            duplicate: () => { if (accountQuery.data) handleDuplicateBusiness(accountQuery.data); },
            remove: () => { if (accountQuery.data) handleDeleteBusiness(accountQuery.data); },
          }}
        />
      ) : (
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <div className="relative w-full max-w-md sm:w-auto sm:flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search accounts"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-full bg-white"
                />
              </div>
              <div className="mr-auto flex flex-wrap gap-1.5" role="group" aria-label="Show accounts">
                {([["all", "All"], ["live", "Live"], ["disabled", "Disabled"], ["over", "Over limit"]] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setListFilter(key)}
                    aria-pressed={listFilter === key}
                    data-testid={`filter-accounts-${key}`}
                    className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${listFilter === key ? "bg-gray-900 text-white" : "border border-black/[0.08] bg-white text-gray-700 hover:bg-gray-50"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Dialog open={isBusinessDialogOpen} onOpenChange={setIsBusinessDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-create-business">
                    <Plus className="w-4 h-4 mr-2" />
                    New account
                  </Button>
                </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create Business Account</DialogTitle>
                  <DialogDescription>
                    Add a new business account with login credentials
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateBusiness} className="space-y-4">
                  <div>
                    <Label htmlFor="businessName">Business Name</Label>
                    <Input
                      id="businessName"
                      placeholder="e.g., Acme Corporation"
                      value={newBusinessName}
                      onChange={(e) => setNewBusinessName(e.target.value)}
                      required
                      data-testid="input-business-name"
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <Label htmlFor="businessWebsite">Website URL</Label>
                    <Input
                      id="businessWebsite"
                      type="url"
                      placeholder="e.g., https://example.com"
                      value={newBusinessWebsite}
                      onChange={(e) => setNewBusinessWebsite(e.target.value)}
                      required
                      data-testid="input-business-website"
                      className="mt-1.5"
                    />
                    <p className="text-xs text-gray-500 mt-1.5">
                      This website will be used to train the AI chatbot
                    </p>
                  </div>
                  <div>
                    <Label>Products</Label>
                    <p className="text-xs text-gray-500 mt-1 mb-3">
                      Select which products to enable for this account
                    </p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between p-2 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-blue-600" />
                          <span className="text-sm font-medium">Chroney Chat</span>
                        </div>
                        <Switch
                          checked={newChroneyEnabled}
                          onCheckedChange={setNewChroneyEnabled}
                        />
                      </div>
                      <div className="flex items-center justify-between p-2 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <MessageCircle className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-medium">WhatsApp AI Agent</span>
                        </div>
                        <Switch
                          checked={newWhatsappEnabled}
                          onCheckedChange={setNewWhatsappEnabled}
                        />
                      </div>
                      <div className="flex items-center justify-between p-2 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <Gem className="w-4 h-4 text-amber-600" />
                          <span className="text-sm font-medium">Jewelry Showcase</span>
                        </div>
                        <Switch
                          checked={newJewelryEnabled}
                          onCheckedChange={setNewJewelryEnabled}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">Login Credentials</h4>
                    <div>
                      <Label htmlFor="username">Username (Email)</Label>
                      <Input
                        id="username"
                        type="email"
                        placeholder="e.g., admin@acmecorp.com"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        required
                        data-testid="input-username"
                        className="mt-1.5"
                      />
                      <p className="text-xs text-gray-500 mt-1.5">
                        A secure temporary password will be auto-generated. User will be required to change it on first login.
                      </p>
                    </div>
                  </div>
                  <Button type="submit" disabled={createBusinessMutation.isPending} data-testid="button-submit-business" className="w-full">
                    {createBusinessMutation.isPending ? "Creating..." : "Create Business Account"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
            </div>
      )}

          {/* Edit Business Account Dialog */}
          <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Business Account</DialogTitle>
                <DialogDescription>
                  Update the business account details
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleUpdateBusiness} className="space-y-4">
                <div>
                  <Label htmlFor="editBusinessName">Business Name</Label>
                  <Input
                    id="editBusinessName"
                    placeholder="e.g., Acme Corporation"
                    value={editBusinessName}
                    onChange={(e) => setEditBusinessName(e.target.value)}
                    required
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label htmlFor="editBusinessWebsite">Website URL</Label>
                  <Input
                    id="editBusinessWebsite"
                    type="url"
                    placeholder="e.g., https://example.com"
                    value={editBusinessWebsite}
                    onChange={(e) => setEditBusinessWebsite(e.target.value)}
                    required
                    className="mt-1.5"
                  />
                  <p className="text-xs text-gray-500 mt-1.5">
                    This website will be used to train the AI chatbot
                  </p>
                </div>
                <div>
                  <Label>Products</Label>
                  <p className="text-xs text-gray-500 mt-1 mb-3">
                    Select which products to enable for this account
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 border rounded-lg">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-blue-600" />
                        <span className="text-sm font-medium">Chroney Chat</span>
                      </div>
                      <Switch
                        checked={editChroneyEnabled}
                        onCheckedChange={setEditChroneyEnabled}
                      />
                    </div>
                    <div className="flex items-center justify-between p-2 border rounded-lg">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-medium">WhatsApp AI Agent</span>
                      </div>
                      <Switch
                        checked={editWhatsappEnabled}
                        onCheckedChange={setEditWhatsappEnabled}
                      />
                    </div>
                    <div className="flex items-center justify-between p-2 border rounded-lg">
                      <div className="flex items-center gap-2">
                        <Gem className="w-4 h-4 text-amber-600" />
                        <span className="text-sm font-medium">Jewelry Showcase</span>
                      </div>
                      <Switch
                        checked={editJewelryEnabled}
                        onCheckedChange={setEditJewelryEnabled}
                      />
                    </div>
                  </div>
                </div>
                <Button type="submit" disabled={updateBusinessMutation.isPending} className="w-full">
                  {updateBusinessMutation.isPending ? "Updating..." : "Update Business Account"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          {/* Credentials Display Dialog */}
          <Dialog open={credentialsDialogOpen} onOpenChange={setCredentialsDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Business Account Created Successfully!</DialogTitle>
                <DialogDescription>
                  Save these credentials securely. The user will need them to login.
                </DialogDescription>
              </DialogHeader>
              {generatedCredentials && (
                <div className="space-y-4">
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Username</label>
                        <div className="mt-1 p-2 bg-white border border-gray-300 rounded font-mono text-sm break-all">
                          {generatedCredentials.username}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Temporary Password</label>
                        <div className="mt-1 p-2 bg-white border border-gray-300 rounded font-mono text-sm break-all">
                          {generatedCredentials.tempPassword}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="text-blue-600 mt-0.5">ℹ️</div>
                    <p className="text-xs text-blue-800">
                      The user will be required to change this password on their first login for security.
                    </p>
                  </div>
                  <Button 
                    onClick={() => {
                      setCredentialsDialogOpen(false);
                      setGeneratedCredentials(null);
                    }} 
                    className="w-full"
                  >
                    Done
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* View Password Dialog */}
          <Dialog open={viewPasswordDialogOpen} onOpenChange={setViewPasswordDialogOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Manage Credentials</DialogTitle>
                <DialogDescription>
                  View and manage login credentials for {viewPasswordBusiness?.name}
                </DialogDescription>
              </DialogHeader>
              {viewPasswordData && (
                <div className="space-y-4">
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Username</label>
                        <div className="mt-1 p-2 bg-white border border-gray-300 rounded font-mono text-sm break-all">
                          {viewPasswordData.username}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Temporary Password</label>
                        <div className="mt-1 flex gap-2">
                          <div className="flex-1 p-2 bg-white border border-gray-300 rounded font-mono text-sm break-all">
                            {viewPasswordData.tempPassword || "Password has been changed by user"}
                          </div>
                          {viewPasswordData.tempPassword && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleCopyPassword}
                              className="px-3"
                            >
                              {copiedPassword ? (
                                <Check className="h-4 w-4 text-green-600" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  {viewPasswordData.tempPassword && (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="text-amber-600 mt-0.5">⚠️</div>
                      <p className="text-xs text-amber-800">
                        This is a temporary password. The user will be required to change it on first login.
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button 
                      onClick={handleResetPassword}
                      disabled={resetPasswordMutation.isPending}
                      variant="outline"
                      className="flex-1"
                    >
                      {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
                    </Button>
                    <Button 
                      onClick={() => {
                        setViewPasswordDialogOpen(false);
                        setViewPasswordData(null);
                        setViewPasswordBusiness(null);
                      }} 
                      className="flex-1"
                    >
                      Close
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Features: everything this account gets, one list (same screen as Settings › Features on this account) */}
          <Dialog open={!!featuresAccount} onOpenChange={(open) => { if (!open) setFeaturesAccount(null); }}>
            <DialogContent className="sm:max-w-[640px] max-h-[88vh] flex flex-col p-0 gap-0">
              <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-600" />
                  Features · {featuresAccount?.name}
                </DialogTitle>
                <DialogDescription>
                  Switch on what this account gets. Each change saves straight away and updates the account's menus.
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-y-auto flex-1 bg-gray-50/60 px-6 py-4">
                {featuresAccount && <AccountFeaturesSettings key={featuresAccount.id} businessAccountId={featuresAccount.id} />}
              </div>
              <div className="flex justify-end px-6 py-3 border-t shrink-0">
                <Button variant="outline" onClick={() => setFeaturesAccount(null)} data-testid="button-close-features">Done</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation Dialog */}
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-red-600 flex items-center gap-2">
                  <Trash2 className="h-5 w-5" />
                  Delete Business Account
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-3">
                  <p>
                    You are about to permanently delete <strong>{businessToDelete?.name}</strong> and all associated data including:
                  </p>
                  <ul className="list-disc list-inside text-sm space-y-1 text-gray-600">
                    <li>All conversations and messages</li>
                    <li>All leads and contact information</li>
                    <li>All products and FAQs</li>
                    <li>All demo pages</li>
                    <li>All appointments and schedules</li>
                    <li>User accounts associated with this business</li>
                  </ul>
                  <p className="font-semibold text-red-600">
                    This action cannot be undone!
                  </p>
                  <div className="pt-2">
                    <Label htmlFor="deletePassword" className="text-sm font-medium">
                      Enter your SuperAdmin password to confirm:
                    </Label>
                    <Input
                      id="deletePassword"
                      type="password"
                      placeholder="Enter your password"
                      value={deletePassword}
                      onChange={(e) => {
                        setDeletePassword(e.target.value);
                        setDeleteError("");
                      }}
                      className="mt-2"
                    />
                    {deleteError && (
                      <p className="text-sm text-red-600 mt-2">{deleteError}</p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel 
                  onClick={() => {
                    setDeleteDialogOpen(false);
                    setBusinessToDelete(null);
                    setDeletePassword("");
                    setDeleteError("");
                  }}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleConfirmDelete}
                  disabled={deleteBusinessMutation.isPending || !deletePassword.trim()}
                  className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                >
                  {deleteBusinessMutation.isPending ? "Deleting..." : "Delete Permanently"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Duplicate Account Dialog */}
          <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
            <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Copy className="h-5 w-5 text-blue-600" />
                  Duplicate Business Account
                </DialogTitle>
                <DialogDescription>
                  Create a copy of {businessToDuplicate?.name} with selected data. A new admin user will be created for this account.
                </DialogDescription>
              </DialogHeader>
              
              <form onSubmit={handleDuplicateSubmit} className="space-y-4 py-4">
                {/* New Account Details */}
                <div className="space-y-3">
                  <h4 className="font-medium text-sm text-gray-700">New Account Details</h4>
                  <div className="space-y-2">
                    <Label htmlFor="duplicateName">Account Name *</Label>
                    <Input
                      id="duplicateName"
                      value={duplicateName}
                      onChange={(e) => setDuplicateName(e.target.value)}
                      placeholder="Enter account name"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="duplicateWebsite">Website</Label>
                    <Input
                      id="duplicateWebsite"
                      value={duplicateWebsite}
                      onChange={(e) => setDuplicateWebsite(e.target.value)}
                      placeholder="https://example.com"
                    />
                  </div>
                </div>

                {/* Admin User Details */}
                <div className="space-y-3 pt-4 border-t">
                  <h4 className="font-medium text-sm text-gray-700">Admin User for New Account</h4>
                  <div className="space-y-2">
                    <Label htmlFor="duplicateAdminName">Name</Label>
                    <Input
                      id="duplicateAdminName"
                      value={duplicateAdminName}
                      onChange={(e) => setDuplicateAdminName(e.target.value)}
                      placeholder="Admin name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="duplicateAdminEmail">Email *</Label>
                    <Input
                      id="duplicateAdminEmail"
                      type="email"
                      value={duplicateAdminEmail}
                      onChange={(e) => setDuplicateAdminEmail(e.target.value)}
                      placeholder="admin@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="duplicateAdminPassword">Password *</Label>
                    <Input
                      id="duplicateAdminPassword"
                      type="password"
                      value={duplicateAdminPassword}
                      onChange={(e) => setDuplicateAdminPassword(e.target.value)}
                      placeholder="Enter password"
                      required
                      minLength={6}
                    />
                  </div>
                </div>

                {/* Data to Copy */}
                <div className="space-y-3 pt-4 border-t">
                  <h4 className="font-medium text-sm text-gray-700">Data to Copy</h4>
                  <div className="grid gap-2">
                    {[
                      { key: 'copyProducts', label: 'Products & Categories' },
                      { key: 'copyFaqs', label: 'FAQs' },
                      { key: 'copyTrainingDocuments', label: 'Training Documents' },
                      { key: 'copyConversationJourneys', label: 'Conversation Journeys' },
                      { key: 'copyScheduleTemplates', label: 'Appointment Templates' },
                      { key: 'copyWidgetSettings', label: 'Widget Settings' },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={key}
                          checked={duplicateOptions[key as keyof typeof duplicateOptions]}
                          onChange={(e) => setDuplicateOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <Label htmlFor={key} className="text-sm font-normal cursor-pointer">{label}</Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDuplicateDialogOpen(false);
                      resetDuplicateForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={duplicateAccountMutation.isPending || !duplicateName.trim() || !duplicateAdminEmail.trim() || !duplicateAdminPassword.trim()}
                    
                  >
                    {duplicateAccountMutation.isPending ? "Duplicating..." : "Duplicate Account"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {!accountId && (isLoadingAccounts ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-gray-600">Loading business accounts...</p>
            </div>
          ) : businessAccounts.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <Building2 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No business accounts yet</h3>
              <p className="text-sm text-gray-600">
                Create your first business account to get started
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-black/[0.07] bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Business</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="min-w-[230px]">Agents & add-ons</TableHead>
                    <TableHead className="whitespace-nowrap text-right">AI spend ({monthLabel(usageMonth).slice(0, 3)})</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleAccounts.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No accounts match.</TableCell></TableRow>
                  )}
                  {visibleAccounts.map((business) => {
                    const spend = usageById.get(business.id);
                    return (
                      <TableRow
                        key={business.id}
                        className="cursor-pointer hover:bg-gray-50/80"
                        onClick={() => setLocation(accountHref(business.id))}
                        data-testid={`row-account-${business.id}`}
                      >
                        <TableCell>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-semibold text-gray-900">{business.name}</span>
                              {business.status !== "active" && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">Disabled</span>}
                            </div>
                            {business.website && <div className="truncate text-xs text-gray-500">{domainOf(business.website)}</div>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${business.isLive ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                            {business.isLive ? "Live" : "Not live"}
                          </span>
                        </TableCell>
                        <TableCell><FeatureChips account={business} /></TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div className="text-sm text-gray-900">{spend ? formatUsd(spend.costUsd) : "—"}</div>
                          <div className={`text-xs ${spend?.limit?.level === "exceeded" ? "text-red-600" : spend?.limit?.level === "warn" ? "text-amber-600" : "text-gray-500"}`}>
                            {spend?.limit ? `of ${formatUsd(spend.limit.monthlyLimitUsd)}` : "No limit"}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-gray-600">
                          {new Date(business.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {business.id === "760c81e7-7f3f-497b-8f0d-b0dc54903c4a" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => window.open('/demo/razorpay-rize', '_blank')}
                                className="text-purple-600 hover:text-purple-700 hover:bg-purple-50 border-purple-200 h-8"
                              >
                                <Play className="h-4 w-4 sm:mr-1.5" />
                                <span className="hidden sm:inline">Demo</span>
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openFeatures(business)}
                              data-testid={`button-features-${business.id}`}
                              className="h-8 bg-white"
                            >
                              <Sparkles className="h-4 w-4 sm:mr-1.5" />
                              <span className="hidden sm:inline">Features</span>
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setLocation(accountHref(business.id))}>
                                  <Building2 className="h-4 w-4 mr-2" />
                                  Open account page
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => handleImpersonate(business)}
                                  disabled={impersonateMutation.isPending}
                                  className="text-blue-600 focus:text-blue-600 focus:bg-blue-50"
                                >
                                  <LogIn className="h-4 w-4 mr-2" />
                                  Open portal (view as the business)
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleEditBusiness(business)}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleViewPassword(business)}>
                                  <Eye className="h-4 w-4 mr-2" />
                                  Login details
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => handleToggleStatus(business)}
                                  disabled={toggleStatusMutation.isPending}
                                >
                                  <Power className="h-4 w-4 mr-2" />
                                  {business.status === "active" ? "Disable account" : "Enable account"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setAvatarAccount({ id: business.id, name: business.name })}>
                                  <Video className="h-4 w-4 mr-2" />
                                  Live AI avatar
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setRetentionAccount({ id: business.id, name: business.name })}>
                                  <Timer className="h-4 w-4 mr-2" />
                                  Auto-delete (data retention)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDuplicateBusiness(business)}>
                                  <Copy className="h-4 w-4 mr-2" />
                                  Duplicate account
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  onClick={() => handleDeleteBusiness(business)}
                                  className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete account
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              
              {/* Sentinel element for IntersectionObserver + Loading indicator */}
              <div ref={loadMoreRef} className="py-4">
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center border-t border-gray-100 pt-4">
                    <div className="w-5 h-5 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mr-2" />
                    <span className="text-sm text-gray-500">Loading more accounts...</span>
                  </div>
                )}
                
                {/* End of list indicator */}
                {!hasNextPage && !isFetchingNextPage && businessAccounts.length >= ACCOUNTS_PER_PAGE && (
                  <div className="text-center text-sm text-gray-400 border-t border-gray-100 pt-3">
                    Showing all {totalAccounts} accounts
                  </div>
                )}
              </div>
            </div>
          ))}
      {avatarAccount && (
        <LiveAvatarSettingsDialog
          open={!!avatarAccount}
          onOpenChange={(o) => { if (!o) setAvatarAccount(null); }}
          businessAccountId={avatarAccount.id}
          businessName={avatarAccount.name}
        />
      )}
      {retentionAccount && (
        <DataRetentionDialog
          open={!!retentionAccount}
          onOpenChange={(o) => { if (!o) setRetentionAccount(null); }}
          scopeType="account"
          scopeId={retentionAccount.id}
          scopeName={retentionAccount.name}
        />
      )}
    </>
  );
}
