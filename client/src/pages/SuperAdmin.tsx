import { useState, useEffect, useRef } from "react";
import { useMutation, useInfiniteQuery } from "@tanstack/react-query";
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
import { Plus, Building2, Pencil, Copy, Check, ShieldCheck, ShoppingBag, Calendar, Sparkles, MoreVertical, Eye, Mic, Camera, Search, Trash2, Gem, Power, LogIn, Headphones, Play, MessageCircle, MessageSquare, GraduationCap, Briefcase, PackageOpen, Megaphone } from "lucide-react";
import type { BusinessAccountDto, ProductTier, SystemMode } from "@shared/dto/businessAccount";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";

export default function SuperAdmin() {
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
  
  const [modulesDialogOpen, setModulesDialogOpen] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessAccountDto | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [businessToDelete, setBusinessToDelete] = useState<BusinessAccountDto | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  
  const [tierDialogOpen, setTierDialogOpen] = useState(false);
  const [tierBusiness, setTierBusiness] = useState<BusinessAccountDto | null>(null);
  const [selectedTier, setSelectedTier] = useState<ProductTier>("chroney");
  const [tierChroneyEnabled, setTierChroneyEnabled] = useState(true);
  const [tierWhatsappEnabled, setTierWhatsappEnabled] = useState(false);
  const [tierInstagramEnabled, setTierInstagramEnabled] = useState(false);
  const [tierFacebookEnabled, setTierFacebookEnabled] = useState(false);
  const [tierJewelryEnabled, setTierJewelryEnabled] = useState(false);
  const [tierK12EducationEnabled, setTierK12EducationEnabled] = useState(false);
  const [tierJobPortalEnabled, setTierJobPortalEnabled] = useState(false);
  
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
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
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

  // Toggle business account feature settings mutation
  const toggleFeaturesMutation = useMutation({
    mutationFn: async (data: { id: string; shopifyEnabled?: boolean; appointmentsEnabled?: boolean; voiceModeEnabled?: boolean; visualSearchEnabled?: boolean; jewelryShowcaseEnabled?: boolean; supportTicketsEnabled?: boolean; whatsappEnabled?: boolean; whatsappMarketingEnabled?: boolean; k12EducationEnabled?: boolean; demoOrdersEnabled?: boolean; systemMode?: SystemMode }) => {
      return await apiRequest<BusinessAccountDto>("PATCH", `/api/business-accounts/${data.id}/features`, {
        shopifyEnabled: data.shopifyEnabled,
        appointmentsEnabled: data.appointmentsEnabled,
        voiceModeEnabled: data.voiceModeEnabled,
        visualSearchEnabled: data.visualSearchEnabled,
        jewelryShowcaseEnabled: data.jewelryShowcaseEnabled,
        supportTicketsEnabled: data.supportTicketsEnabled,
        whatsappEnabled: data.whatsappEnabled,
        whatsappMarketingEnabled: data.whatsappMarketingEnabled,
        k12EducationEnabled: data.k12EducationEnabled,
        demoOrdersEnabled: data.demoOrdersEnabled,
        systemMode: data.systemMode,
      });
    },
    onSuccess: (updatedBusiness) => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      // Update selectedBusiness with fresh data from server response
      if (selectedBusiness && selectedBusiness.id === updatedBusiness.id) {
        setSelectedBusiness(updatedBusiness);
      }
      toast({
        title: "Success",
        description: "Feature settings updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update feature settings",
        variant: "destructive",
      });
    },
  });

  const handleToggleShopify = (business: BusinessAccountDto) => {
    const newValue = !business.shopifyEnabled;
    // Deep copy using structuredClone for complete isolation
    const previousState = selectedBusiness ? structuredClone(selectedBusiness) : null;
    
    // Optimistically update selectedBusiness using functional updater
    if (selectedBusiness && selectedBusiness.id === business.id) {
      setSelectedBusiness(prev => prev ? {...prev, shopifyEnabled: newValue} : prev);
    }
    toggleFeaturesMutation.mutate(
      {
        id: business.id,
        shopifyEnabled: newValue,
      },
      {
        onError: () => {
          // Rollback only if still on the same business (functional updater prevents cross-business contamination)
          setSelectedBusiness(prev => 
            (prev && prev.id === business.id && previousState) ? previousState : prev
          );
          queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
        }
      }
    );
  };

  const handleToggleAppointments = (business: BusinessAccountDto) => {
    const newValue = !business.appointmentsEnabled;
    // Deep copy using structuredClone for complete isolation
    const previousState = selectedBusiness ? structuredClone(selectedBusiness) : null;
    
    // Optimistically update selectedBusiness using functional updater
    if (selectedBusiness && selectedBusiness.id === business.id) {
      setSelectedBusiness(prev => prev ? {...prev, appointmentsEnabled: newValue} : prev);
    }
    toggleFeaturesMutation.mutate(
      {
        id: business.id,
        appointmentsEnabled: newValue,
      },
      {
        onError: () => {
          // Rollback only if still on the same business (functional updater prevents cross-business contamination)
          setSelectedBusiness(prev => 
            (prev && prev.id === business.id && previousState) ? previousState : prev
          );
          queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
        }
      }
    );
  };

  const handleToggleVoiceMode = (business: BusinessAccountDto) => {
    const newValue = !business.voiceModeEnabled;
    // Deep copy using structuredClone for complete isolation
    const previousState = selectedBusiness ? structuredClone(selectedBusiness) : null;
    
    // Optimistically update selectedBusiness using functional updater
    if (selectedBusiness && selectedBusiness.id === business.id) {
      setSelectedBusiness(prev => prev ? {...prev, voiceModeEnabled: newValue} : prev);
    }
    toggleFeaturesMutation.mutate(
      {
        id: business.id,
        voiceModeEnabled: newValue,
      },
      {
        onError: () => {
          // Rollback only if still on the same business (functional updater prevents cross-business contamination)
          setSelectedBusiness(prev => 
            (prev && prev.id === business.id && previousState) ? previousState : prev
          );
          queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
        }
      }
    );
  };

  const handleToggleVisualSearch = (business: BusinessAccountDto) => {
    const newValue = !business.visualSearchEnabled;
    // Deep copy using structuredClone for complete isolation
    const previousState = selectedBusiness ? structuredClone(selectedBusiness) : null;
    
    // Optimistically update selectedBusiness using functional updater
    if (selectedBusiness && selectedBusiness.id === business.id) {
      setSelectedBusiness(prev => prev ? {...prev, visualSearchEnabled: newValue} : prev);
    }
    toggleFeaturesMutation.mutate(
      {
        id: business.id,
        visualSearchEnabled: newValue,
      },
      {
        onError: () => {
          // Rollback only if still on the same business (functional updater prevents cross-business contamination)
          setSelectedBusiness(prev => 
            (prev && prev.id === business.id && previousState) ? previousState : prev
          );
          queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
        }
      }
    );
  };

  const handleToggleJewelryShowcase = (business: BusinessAccountDto) => {
    const newValue = !business.jewelryShowcaseEnabled;
    // Deep copy using structuredClone for complete isolation
    const previousState = selectedBusiness ? structuredClone(selectedBusiness) : null;
    
    // Optimistically update selectedBusiness using functional updater
    if (selectedBusiness && selectedBusiness.id === business.id) {
      setSelectedBusiness(prev => prev ? {...prev, jewelryShowcaseEnabled: newValue} : prev);
    }
    toggleFeaturesMutation.mutate(
      {
        id: business.id,
        jewelryShowcaseEnabled: newValue,
      },
      {
        onError: () => {
          // Rollback only if still on the same business (functional updater prevents cross-business contamination)
          setSelectedBusiness(prev => 
            (prev && prev.id === business.id && previousState) ? previousState : prev
          );
          queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
        }
      }
    );
  };

  const handleToggleSupportTickets = (business: BusinessAccountDto) => {
    const newValue = !business.supportTicketsEnabled;
    // Deep copy using structuredClone for complete isolation
    const previousState = selectedBusiness ? structuredClone(selectedBusiness) : null;
    
    // Optimistically update selectedBusiness using functional updater
    if (selectedBusiness && selectedBusiness.id === business.id) {
      setSelectedBusiness(prev => prev ? {...prev, supportTicketsEnabled: newValue} : prev);
    }
    toggleFeaturesMutation.mutate(
      {
        id: business.id,
        supportTicketsEnabled: newValue,
      },
      {
        onError: () => {
          // Rollback only if still on the same business (functional updater prevents cross-business contamination)
          setSelectedBusiness(prev => 
            (prev && prev.id === business.id && previousState) ? previousState : prev
          );
          queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
        }
      }
    );
  };

  const handleToggleWhatsapp = (business: BusinessAccountDto) => {
    const newValue = !business.whatsappEnabled;
    // Deep copy using structuredClone for complete isolation
    const previousState = selectedBusiness ? structuredClone(selectedBusiness) : null;
    
    // Optimistically update selectedBusiness using functional updater
    if (selectedBusiness && selectedBusiness.id === business.id) {
      setSelectedBusiness(prev => prev ? {...prev, whatsappEnabled: newValue} : prev);
    }
    toggleFeaturesMutation.mutate(
      {
        id: business.id,
        whatsappEnabled: newValue,
      },
      {
        onError: () => {
          // Rollback only if still on the same business (functional updater prevents cross-business contamination)
          setSelectedBusiness(prev => 
            (prev && prev.id === business.id && previousState) ? previousState : prev
          );
          queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
        }
      }
    );
  };

  const handleToggleK12Education = (business: BusinessAccountDto) => {
    const newValue = !business.k12EducationEnabled;
    const previousState = selectedBusiness ? structuredClone(selectedBusiness) : null;
    
    if (selectedBusiness && selectedBusiness.id === business.id) {
      setSelectedBusiness(prev => prev ? {...prev, k12EducationEnabled: newValue} : prev);
    }
    toggleFeaturesMutation.mutate(
      {
        id: business.id,
        k12EducationEnabled: newValue,
      },
      {
        onError: () => {
          setSelectedBusiness(prev => 
            (prev && prev.id === business.id && previousState) ? previousState : prev
          );
          queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
        }
      }
    );
  };

  const handleToggleWhatsappMarketing = (business: BusinessAccountDto) => {
    const newValue = !business.whatsappMarketingEnabled;
    const previousState = selectedBusiness ? structuredClone(selectedBusiness) : null;
    if (selectedBusiness && selectedBusiness.id === business.id) {
      setSelectedBusiness(prev => prev ? {...prev, whatsappMarketingEnabled: newValue} : prev);
    }
    toggleFeaturesMutation.mutate(
      { id: business.id, whatsappMarketingEnabled: newValue },
      {
        onError: () => {
          setSelectedBusiness(prev =>
            (prev && prev.id === business.id && previousState) ? previousState : prev
          );
          queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
        }
      }
    );
  };

  const handleToggleDemoOrders = (business: BusinessAccountDto) => {
    const newValue = !business.demoOrdersEnabled;
    const previousState = selectedBusiness ? structuredClone(selectedBusiness) : null;
    if (selectedBusiness && selectedBusiness.id === business.id) {
      setSelectedBusiness(prev => prev ? {...prev, demoOrdersEnabled: newValue} : prev);
    }
    toggleFeaturesMutation.mutate(
      { id: business.id, demoOrdersEnabled: newValue },
      {
        onError: () => {
          setSelectedBusiness(prev =>
            (prev && prev.id === business.id && previousState) ? previousState : prev
          );
          queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
        }
      }
    );
  };

  const handleSystemModeChange = (business: BusinessAccountDto, newMode: SystemMode) => {
    // Deep copy using structuredClone for complete isolation
    const previousState = selectedBusiness ? structuredClone(selectedBusiness) : null;
    
    // Optimistically update selectedBusiness using functional updater
    if (selectedBusiness && selectedBusiness.id === business.id) {
      setSelectedBusiness(prev => prev ? {...prev, systemMode: newMode} : prev);
    }
    toggleFeaturesMutation.mutate(
      {
        id: business.id,
        systemMode: newMode,
      },
      {
        onError: () => {
          // Rollback only if still on the same business (functional updater prevents cross-business contamination)
          setSelectedBusiness(prev => 
            (prev && prev.id === business.id && previousState) ? previousState : prev
          );
          queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
        }
      }
    );
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

  const handleManageModules = (business: BusinessAccountDto) => {
    setSelectedBusiness(business);
    setModulesDialogOpen(true);
  };

  const handleChangeTier = (business: BusinessAccountDto) => {
    setTierBusiness(business);
    setSelectedTier(business.productTier || "chroney");
    // Set checkbox values based on feature flags
    setTierChroneyEnabled(business.chroneyEnabled ?? true);
    setTierJewelryEnabled(business.productTier === "jewelry_showcase" || business.productTier === "jewelry_showcase_chroney");
    setTierWhatsappEnabled(business.whatsappEnabled || false);
    setTierInstagramEnabled(business.instagramEnabled || false);
    setTierFacebookEnabled(business.facebookEnabled || false);
    setTierK12EducationEnabled(business.k12EducationEnabled || false);
    setTierJobPortalEnabled(business.jobPortalEnabled || false);
    setTierDialogOpen(true);
  };

  const updateTierMutation = useMutation({
    mutationFn: async (data: { 
      id: string; 
      productTier: ProductTier; 
      name: string; 
      website: string;
      chroneyEnabled: boolean;
      whatsappEnabled: boolean;
      instagramEnabled: boolean;
      facebookEnabled: boolean;
      k12EducationEnabled: boolean;
      jobPortalEnabled: boolean;
    }) => {
      return await apiRequest("PUT", `/api/business-accounts/${data.id}`, { 
        name: data.name, 
        website: data.website, 
        productTier: data.productTier,
        chroneyEnabled: data.chroneyEnabled,
        whatsappEnabled: data.whatsappEnabled,
        instagramEnabled: data.instagramEnabled,
        facebookEnabled: data.facebookEnabled,
        k12EducationEnabled: data.k12EducationEnabled,
        jobPortalEnabled: data.jobPortalEnabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setTierDialogOpen(false);
      setTierBusiness(null);
      toast({
        title: "Product Features Updated",
        description: "The product features have been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update product features",
        variant: "destructive",
      });
    },
  });

  const handleSaveTier = () => {
    if (tierBusiness) {
      // Derive productTier from checkbox selections
      let productTier: ProductTier = "chroney";
      if (tierChroneyEnabled && tierJewelryEnabled) {
        productTier = "jewelry_showcase_chroney";
      } else if (tierJewelryEnabled) {
        productTier = "jewelry_showcase";
      } else {
        productTier = "chroney";
      }
      
      updateTierMutation.mutate({ 
        id: tierBusiness.id, 
        productTier,
        name: tierBusiness.name,
        website: tierBusiness.website || "",
        chroneyEnabled: tierChroneyEnabled,
        whatsappEnabled: tierWhatsappEnabled,
        instagramEnabled: tierInstagramEnabled,
        facebookEnabled: tierFacebookEnabled,
        k12EducationEnabled: tierK12EducationEnabled,
        jobPortalEnabled: tierJobPortalEnabled,
      });
    }
  };

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
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/business-accounts", "paginated"] });
      setDeleteDialogOpen(false);
      setBusinessToDelete(null);
      setDeletePassword("");
      setDeleteError("");
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
              <p className="text-[11px] text-white/90 leading-tight mt-0.5">Super Admin Dashboard</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-gray-50">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
          <div className="mb-6">
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-900">Business Accounts</h2>
              <p className="text-muted-foreground mt-1">
                Manage business accounts and their users
              </p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search business accounts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-full"
                />
              </div>
              <Dialog open={isBusinessDialogOpen} onOpenChange={setIsBusinessDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 shadow-sm" data-testid="button-create-business">
                    <Plus className="w-4 h-4 mr-2" />
                    New Business Account
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
          </div>

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

          {/* Manage Modules Dialog */}
          <Dialog open={modulesDialogOpen} onOpenChange={setModulesDialogOpen}>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-blue-600" />
                  Manage Modules - {selectedBusiness?.name}
                </DialogTitle>
                <DialogDescription>
                  Enable or disable modules for this business account. Changes take effect immediately and will update the user's sidebar menu.
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                {/* System Mode Selector - Top of dialog */}
                <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">System Mode</h4>
                      <p className="text-sm text-gray-600">
                        {selectedBusiness?.systemMode === 'essential' 
                          ? 'Essential mode shows only core pages (Home, Insights, Leads, Conversations, Products, Widget, Settings)'
                          : 'Full mode shows all features including Training, Smart Discounts, Gaps, and more'}
                      </p>
                    </div>
                    <Select
                      value={selectedBusiness?.systemMode || 'full'}
                      onValueChange={(value: SystemMode) => {
                        if (selectedBusiness) {
                          handleSystemModeChange(selectedBusiness, value);
                        }
                      }}
                      disabled={toggleFeaturesMutation.isPending}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">Full</SelectItem>
                        <SelectItem value="essential">Essential</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Show Chroney modules only when Chroney Chat is enabled */}
                {selectedBusiness?.chroneyEnabled && (
                  <>
                    {/* Shopify Module */}
                    <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center flex-shrink-0">
                        <ShoppingBag className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900 mb-1">Shopify Integration</h4>
                        <p className="text-sm text-gray-600 mb-2">
                          Connect to Shopify stores, sync products automatically, and manage inventory through the Shopify tab.
                        </p>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={selectedBusiness?.shopifyEnabled || false}
                            onCheckedChange={(checked) => {
                              if (selectedBusiness) {
                                handleToggleShopify(selectedBusiness);
                              }
                            }}
                            disabled={toggleFeaturesMutation.isPending}
                          />
                          <span className="text-sm font-medium text-gray-700">
                            {selectedBusiness?.shopifyEnabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Appointments Module */}
                    <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                        <Calendar className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900 mb-1">Appointment Booking</h4>
                        <p className="text-sm text-gray-600 mb-2">
                          AI-powered appointment scheduling with weekly templates, slot overrides, and conversational booking through Chroney.
                        </p>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={selectedBusiness?.appointmentsEnabled || false}
                            onCheckedChange={(checked) => {
                              if (selectedBusiness) {
                                handleToggleAppointments(selectedBusiness);
                              }
                            }}
                            disabled={toggleFeaturesMutation.isPending}
                          />
                          <span className="text-sm font-medium text-gray-700">
                            {selectedBusiness?.appointmentsEnabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Voice Mode Module */}
                    <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                        <Mic className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900 mb-1">Voice Mode</h4>
                        <p className="text-sm text-gray-600 mb-2">
                          Real-time conversational voice mode with ChatGPT-style full-screen interface, animated orb, and zero-latency streaming responses.
                        </p>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={selectedBusiness?.voiceModeEnabled || false}
                            onCheckedChange={(checked) => {
                              if (selectedBusiness) {
                                handleToggleVoiceMode(selectedBusiness);
                              }
                            }}
                            disabled={toggleFeaturesMutation.isPending}
                          />
                          <span className="text-sm font-medium text-gray-700">
                            {selectedBusiness?.voiceModeEnabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Visual Product Search Module */}
                    <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center flex-shrink-0">
                        <Camera className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900 mb-1">Visual Product Search</h4>
                        <p className="text-sm text-gray-600 mb-2">
                          Allow customers to upload product images to find similar items in the catalog using AI-powered visual matching.
                        </p>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={selectedBusiness?.visualSearchEnabled || false}
                            onCheckedChange={(checked) => {
                              if (selectedBusiness) {
                                handleToggleVisualSearch(selectedBusiness);
                              }
                            }}
                            disabled={toggleFeaturesMutation.isPending}
                          />
                          <span className="text-sm font-medium text-gray-700">
                            {selectedBusiness?.visualSearchEnabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Show Jewelry Showcase module only for 'jewelry_showcase' or 'jewelry_showcase_chroney' tiers */}
                {(selectedBusiness?.productTier === 'jewelry_showcase' || selectedBusiness?.productTier === 'jewelry_showcase_chroney') && (
                  <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-yellow-600 flex items-center justify-center flex-shrink-0">
                      <Gem className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 mb-1">Jewelry Showcase</h4>
                      <p className="text-sm text-gray-600 mb-2">
                        In-store tablet kiosk for jewelry stores. Customers can browse inventory, search by image or text, with elegant jewelry-themed design.
                      </p>
                      {/* For jewelry-only tier, this is mandatory and cannot be toggled */}
                      {selectedBusiness?.productTier === 'jewelry_showcase' ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-green-600 bg-green-50 px-2 py-1 rounded">
                            Always Enabled (Core Feature)
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={selectedBusiness?.jewelryShowcaseEnabled || false}
                            onCheckedChange={(checked) => {
                              if (selectedBusiness) {
                                handleToggleJewelryShowcase(selectedBusiness);
                              }
                            }}
                            disabled={toggleFeaturesMutation.isPending}
                          />
                          <span className="text-sm font-medium text-gray-700">
                            {selectedBusiness?.jewelryShowcaseEnabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Show Shopify for jewelry-only tier (since it's not shown in the Chroney modules section) */}
                {selectedBusiness?.productTier === 'jewelry_showcase' && (
                  <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center flex-shrink-0">
                      <ShoppingBag className="h-5 w-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 mb-1">Shopify Integration</h4>
                      <p className="text-sm text-gray-600 mb-2">
                        Connect to Shopify stores, sync products automatically, and manage inventory through the Shopify tab.
                      </p>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={selectedBusiness?.shopifyEnabled || false}
                          onCheckedChange={(checked) => {
                            if (selectedBusiness) {
                              handleToggleShopify(selectedBusiness);
                            }
                          }}
                          disabled={toggleFeaturesMutation.isPending}
                        />
                        <span className="text-sm font-medium text-gray-700">
                          {selectedBusiness?.shopifyEnabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Support Tickets Module - Available for all tiers */}
                <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center flex-shrink-0">
                    <Headphones className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 mb-1">Support Tickets</h4>
                    <p className="text-sm text-gray-600 mb-2">
                      Exception queue for handling tickets that require human intervention. AI handles routine queries automatically.
                    </p>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={selectedBusiness?.supportTicketsEnabled || false}
                        onCheckedChange={(checked) => {
                          if (selectedBusiness) {
                            handleToggleSupportTickets(selectedBusiness);
                          }
                        }}
                        disabled={toggleFeaturesMutation.isPending}
                      />
                      <span className="text-sm font-medium text-gray-700">
                        {selectedBusiness?.supportTicketsEnabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* K12 Education Module */}
                <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                    <GraduationCap className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 mb-1">K12 Education</h4>
                    <p className="text-sm text-gray-600 mb-2">
                      Subject/chapter/topic content management with AI tutor capabilities for K12 students.
                    </p>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={selectedBusiness?.k12EducationEnabled || false}
                        onCheckedChange={(checked) => {
                          if (selectedBusiness) {
                            handleToggleK12Education(selectedBusiness);
                          }
                        }}
                        disabled={toggleFeaturesMutation.isPending}
                      />
                      <span className="text-sm font-medium text-gray-700">
                        {selectedBusiness?.k12EducationEnabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* WhatsApp Marketing Module */}
                <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center flex-shrink-0">
                    <Megaphone className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 mb-1">WhatsApp Marketing</h4>
                    <p className="text-sm text-gray-600 mb-2">
                      Send approved WhatsApp template campaigns to CSV-imported contact groups, schedule blasts, and let AI negotiate with each reply per-campaign. Includes opt-out (STOP) handling and a per-recipient AI transcript viewer.
                    </p>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={selectedBusiness?.whatsappMarketingEnabled || false}
                        onCheckedChange={() => {
                          if (selectedBusiness) {
                            handleToggleWhatsappMarketing(selectedBusiness);
                          }
                        }}
                        disabled={toggleFeaturesMutation.isPending}
                        data-testid="switch-whatsapp-marketing"
                      />
                      <span className="text-sm font-medium text-gray-700">
                        {selectedBusiness?.whatsappMarketingEnabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Demo Orders Module */}
                <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center flex-shrink-0">
                    <PackageOpen className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 mb-1">Demo Orders</h4>
                    <p className="text-sm text-gray-600 mb-2">
                      Self-contained demo order management for e-commerce chatbot demos. Lets customers track orders, request returns, and check order status — no real backend needed.
                    </p>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={selectedBusiness?.demoOrdersEnabled || false}
                        onCheckedChange={() => {
                          if (selectedBusiness) {
                            handleToggleDemoOrders(selectedBusiness);
                          }
                        }}
                        disabled={toggleFeaturesMutation.isPending}
                      />
                      <span className="text-sm font-medium text-gray-700">
                        {selectedBusiness?.demoOrdersEnabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </div>
                </div>

                              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setModulesDialogOpen(false);
                    setSelectedBusiness(null);
                  }}
                >
                  Close
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Product Tier Dialog */}
          <Dialog open={tierDialogOpen} onOpenChange={setTierDialogOpen}>
            <DialogContent className="sm:max-w-[420px] max-h-[85vh] flex flex-col p-0 gap-0">
              <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-600" />
                  Product Features
                </DialogTitle>
                <DialogDescription>
                  Select which products are enabled for {tierBusiness?.name}.
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 px-6 py-2 overflow-y-auto flex-1">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Chroney Chat</p>
                        <p className="text-xs text-gray-500">AI chatbot, conversations, training</p>
                      </div>
                    </div>
                    <Switch
                      checked={tierChroneyEnabled}
                      onCheckedChange={setTierChroneyEnabled}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                        <MessageCircle className="w-5 h-5 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">WhatsApp AI Agent</p>
                        <p className="text-xs text-gray-500">Lead capture via WhatsApp messages</p>
                      </div>
                    </div>
                    <Switch
                      checked={tierWhatsappEnabled}
                      onCheckedChange={setTierWhatsappEnabled}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-pink-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium text-sm">Instagram AI Agent</p>
                        <p className="text-xs text-gray-500">AI replies to Instagram DMs</p>
                      </div>
                    </div>
                    <Switch
                      checked={tierInstagramEnabled}
                      onCheckedChange={setTierInstagramEnabled}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium text-sm">Facebook AI Agent</p>
                        <p className="text-xs text-gray-500">AI replies to Facebook Page DMs</p>
                      </div>
                    </div>
                    <Switch
                      checked={tierFacebookEnabled}
                      onCheckedChange={setTierFacebookEnabled}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                        <Gem className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Jewelry Showcase</p>
                        <p className="text-xs text-gray-500">Visual search, kiosk mode, Vista</p>
                      </div>
                    </div>
                    <Switch
                      checked={tierJewelryEnabled}
                      onCheckedChange={setTierJewelryEnabled}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                        <GraduationCap className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">K12 Education</p>
                        <p className="text-xs text-gray-500">Subject/chapter/topic content, AI tutor</p>
                      </div>
                    </div>
                    <Switch
                      checked={tierK12EducationEnabled}
                      onCheckedChange={setTierK12EducationEnabled}
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-cyan-100 flex items-center justify-center">
                        <Briefcase className="w-5 h-5 text-cyan-600" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Job Portal</p>
                        <p className="text-xs text-gray-500">Job listings, applicant tracking, AI matching</p>
                      </div>
                    </div>
                    <Switch
                      checked={tierJobPortalEnabled}
                      onCheckedChange={setTierJobPortalEnabled}
                    />
                  </div>
                </div>

                {!tierChroneyEnabled && !tierWhatsappEnabled && !tierInstagramEnabled && !tierFacebookEnabled && !tierJewelryEnabled && !tierK12EducationEnabled && !tierJobPortalEnabled && (
                  <p className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
                    At least one product should be enabled.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 px-6 py-4 border-t shrink-0">
                <Button
                  variant="outline"
                  onClick={() => {
                    setTierDialogOpen(false);
                    setTierBusiness(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveTier}
                  disabled={updateTierMutation.isPending || (!tierChroneyEnabled && !tierWhatsappEnabled && !tierInstagramEnabled && !tierFacebookEnabled && !tierJewelryEnabled && !tierK12EducationEnabled && !tierJobPortalEnabled)}
                  className="bg-gradient-to-r from-purple-600 to-blue-600"
                >
                  {updateTierMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
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
                    className="bg-gradient-to-r from-blue-600 to-purple-600"
                  >
                    {duplicateAccountMutation.isPending ? "Duplicating..." : "Duplicate Account"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {isLoadingAccounts ? (
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
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold w-[280px]">Business</TableHead>
                    <TableHead className="font-semibold w-[80px]">Status</TableHead>
                    <TableHead className="font-semibold w-[100px]">Created</TableHead>
                    <TableHead className="font-semibold w-[140px]">Product Tier</TableHead>
                    <TableHead className="font-semibold text-right w-[140px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {businessAccounts
                    .filter((business) => {
                      if (!searchQuery.trim()) return true;
                      const query = searchQuery.toLowerCase();
                      return (
                        business.name.toLowerCase().includes(query) ||
                        (business.website && business.website.toLowerCase().includes(query))
                      );
                    })
                    .map((business) => {
                    const getDomain = (url: string) => {
                      try {
                        const domain = new URL(url).hostname;
                        return domain.replace('www.', '');
                      } catch {
                        return url;
                      }
                    };

                    return (
                      <TableRow key={business.id} className="hover:bg-gray-50">
                        <TableCell className="font-medium">
                          <div className="flex items-start gap-2">
                            <Building2 className="h-4 w-4 text-purple-600 flex-shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate">{business.name}</span>
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${business.status === "active" ? "bg-green-500" : "bg-gray-400"}`} title={business.status} />
                              </div>
                              {business.website && (
                                <a 
                                  href={business.website} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-xs text-purple-600 hover:underline truncate block"
                                  title={business.website}
                                >
                                  {getDomain(business.website)}
                                </a>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            business.isLive 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-gray-100 text-gray-500'
                          }`}>
                            {business.isLive ? 'Live' : 'Not Live'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                          {new Date(business.createdAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })}
                        </TableCell>
                        <TableCell className="text-sm">
                          <button
                            onClick={() => handleChangeTier(business)}
                            className="flex flex-wrap gap-1 cursor-pointer hover:opacity-80 transition-opacity"
                          >
                            {business.chroneyEnabled && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                Chat
                              </span>
                            )}
                            {business.whatsappEnabled && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                WhatsApp
                              </span>
                            )}
                            {business.instagramEnabled && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-700">
                                Instagram
                              </span>
                            )}
                            {business.facebookEnabled && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                Facebook
                              </span>
                            )}
                            {(business.productTier === 'jewelry_showcase' || business.productTier === 'jewelry_showcase_chroney') && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                Jewelry
                              </span>
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="text-right">
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
                              onClick={() => handleManageModules(business)}
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200 h-8"
                            >
                              <ShieldCheck className="h-4 w-4 sm:mr-1.5" />
                              <span className="hidden sm:inline">Modules</span>
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
                                <DropdownMenuItem 
                                  onClick={() => handleImpersonate(business)}
                                  disabled={impersonateMutation.isPending}
                                  className="text-blue-600 focus:text-blue-600 focus:bg-blue-50"
                                >
                                  <LogIn className="h-4 w-4 mr-2" />
                                  Access Account
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleEditBusiness(business)}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleViewPassword(business)}>
                                  <Eye className="h-4 w-4 mr-2" />
                                  Login Credentials
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => handleToggleStatus(business)}
                                  disabled={toggleStatusMutation.isPending}
                                >
                                  <Power className="h-4 w-4 mr-2" />
                                  {business.status === "active" ? "Disable Account" : "Enable Account"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDuplicateBusiness(business)}>
                                  <Copy className="h-4 w-4 mr-2" />
                                  Duplicate Account
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  onClick={() => handleDeleteBusiness(business)}
                                  className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete Account
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
          )}
        </div>
      </div>
    </div>
  );
}

