import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  Percent,
  Loader2,
  Plus,
  Edit,
  Trash2,
  AlertCircle,
  Save,
  InfoIcon,
  Target,
  Clock,
  Gift,
  Sparkles,
  BarChart3,
  ArrowLeft,
  TrendingUp,
  DollarSign,
  Calendar,
  HelpCircle,
  MousePointerClick,
  Timer,
  ShoppingCart,
  Play,
  Smartphone,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface Product {
  id: string;
  name: string;
  price?: number;
}

interface DiscountRule {
  id: string;
  businessAccountId: string;
  productId: string | null;
  productName?: string;
  intentThreshold: number;
  discountPercentage: number;
  discountMessage: string;
  cooldownMinutes: number;
  maxUsesPerVisitor: number;
  expiryMinutes: number;
  isActive: boolean;
  createdAt: string;
}

interface AnalyticsSummary {
  totalOffers: number;
  redeemedOffers: number;
  redemptionRate: number;
  totalRevenue: number;
  avgOrderValue: number;
}

interface ProductAnalytics {
  productId: string;
  productName: string;
  totalOffers: number;
  redeemed: number;
  revenue: number;
}

interface TimeSeriesData {
  date: string;
  offers: number;
  redeemed: number;
  revenue: number;
}

interface AnalyticsData {
  summary: AnalyticsSummary;
  byProduct: ProductAnalytics[];
  timeSeries: TimeSeriesData[];
}

interface ExitIntentSettings {
  id: string;
  businessAccountId: string;
  isEnabled: boolean;
  requireCartItems: boolean;
  mobileExitEnabled: boolean;
  discountPercentage: number;
  discountMessage: string;
  cooldownMinutes: number;
  expiryMinutes: number;
  maxUsesPerVisitor: number;
  createdAt: string;
  updatedAt: string;
}

interface IdleTimeoutSettings {
  id: string;
  businessAccountId: string;
  isEnabled: boolean;
  idleTimeoutSeconds: number;
  requireCartItems: boolean;
  discountPercentage: number;
  discountMessage: string;
  cooldownMinutes: number;
  expiryMinutes: number;
  maxUsesPerVisitor: number;
  createdAt: string;
  updatedAt: string;
}

interface UrgencyOfferSettings {
  id?: string;
  businessAccountId?: string;
  isEnabled: boolean;
  countdownDurationMinutes: number;
  discountType: string;
  discountValue: number;
  headline: string;
  description: string;
  ctaButtonText: string;
  dismissButtonText: string;
  successMessage: string;
  phoneInputLabel: string;
  phoneInputPlaceholder: string;
  requirePhone: boolean;
  intentThreshold: number;
  minMessagesBeforeTrigger: number;
  maxOffersPerVisitor: number;
  cooldownMinutes: number;
  showReminderAfterDismiss: boolean;
}

export default function SmartDiscounts() {
  const { toast } = useToast();
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [dateRange, setDateRange] = useState("30");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<DiscountRule | null>(null);
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const [showIntentScoreDialog, setShowIntentScoreDialog] = useState(false);
  const [formData, setFormData] = useState({
    productId: "site-wide",
    intentThreshold: 70,
    discountPercentage: 10,
    discountMessage: "Hey! I noticed you're interested in {product}. Here's a special {discount}% off just for you!",
    cooldownMinutes: 1440,
    maxUsesPerVisitor: 1,
    expiryMinutes: 60,
    isActive: true,
  });

  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: rules = [], isLoading: rulesLoading } = useQuery<DiscountRule[]>({
    queryKey: ["/api/discount-rules"],
  });

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/discount-analytics", dateRange],
    queryFn: async () => {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - parseInt(dateRange));
      
      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
      
      const response = await fetch(`/api/discount-analytics?${params}`);
      if (!response.ok) throw new Error("Failed to fetch analytics");
      return response.json();
    },
    enabled: showAnalytics,
  });

  const createRuleMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/discount-rules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/discount-rules"] });
      setIsCreateDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Discount rule created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create discount rule",
        variant: "destructive",
      });
    },
  });

  const updateRuleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return await apiRequest("PUT", `/api/discount-rules/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/discount-rules"] });
      setEditingRule(null);
      resetForm();
      toast({
        title: "Success",
        description: "Discount rule updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update discount rule",
        variant: "destructive",
      });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/discount-rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/discount-rules"] });
      toast({
        title: "Success",
        description: "Discount rule deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete discount rule",
        variant: "destructive",
      });
    },
  });

  const toggleRuleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return await apiRequest("PUT", `/api/discount-rules/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/discount-rules"] });
      toast({
        title: "Success",
        description: "Discount rule status updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update rule status",
        variant: "destructive",
      });
    },
  });

  const { data: exitIntentSettings, isLoading: exitIntentLoading } = useQuery<ExitIntentSettings>({
    queryKey: ["/api/exit-intent-settings"],
  });

  const { data: idleTimeoutSettings, isLoading: idleTimeoutLoading } = useQuery<IdleTimeoutSettings>({
    queryKey: ["/api/idle-timeout-settings"],
  });

  const { data: publicChatLink } = useQuery<{ id: string; token: string }>({
    queryKey: ["/api/public-chat-link"],
  });

  const [exitIntentForm, setExitIntentForm] = useState({
    isEnabled: false,
    requireCartItems: false,
    mobileExitEnabled: true,
    discountPercentage: 10,
    discountMessage: "Wait! Before you go, here's {discount}% off your order!",
    cooldownMinutes: 1440,
    expiryMinutes: 60,
    maxUsesPerVisitor: 1,
  });

  const [idleTimeoutForm, setIdleTimeoutForm] = useState({
    isEnabled: false,
    idleTimeoutSeconds: 120,
    requireCartItems: false,
    discountPercentage: 10,
    discountMessage: "Still browsing? Here's {discount}% off to help you decide!",
    cooldownMinutes: 1440,
    expiryMinutes: 60,
    maxUsesPerVisitor: 1,
  });

  const [urgencyOfferForm, setUrgencyOfferForm] = useState<UrgencyOfferSettings>({
    isEnabled: false,
    countdownDurationMinutes: 10,
    discountType: "percentage",
    discountValue: 10,
    headline: "Limited Time Offer!",
    description: "We noticed you're interested! Here's a special discount just for you.",
    ctaButtonText: "Unlock Offer",
    dismissButtonText: "Maybe later",
    successMessage: "Your discount code has been sent to your WhatsApp!",
    phoneInputLabel: "Enter your WhatsApp number",
    phoneInputPlaceholder: "9999-0808-25",
    requirePhone: true,
    intentThreshold: 70,
    minMessagesBeforeTrigger: 3,
    maxOffersPerVisitor: 1,
    cooldownMinutes: 30,
    showReminderAfterDismiss: true,
  });

  const updateExitIntentMutation = useMutation({
    mutationFn: async (data: Partial<ExitIntentSettings>) => {
      return await apiRequest("PUT", "/api/exit-intent-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exit-intent-settings"] });
      toast({
        title: "Success",
        description: "Exit intent settings updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update exit intent settings",
        variant: "destructive",
      });
    },
  });

  const updateIdleTimeoutMutation = useMutation({
    mutationFn: async (data: Partial<IdleTimeoutSettings>) => {
      return await apiRequest("PUT", "/api/idle-timeout-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/idle-timeout-settings"] });
      toast({
        title: "Success",
        description: "Idle timeout settings updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update idle timeout settings",
        variant: "destructive",
      });
    },
  });

  const { data: urgencyCampaignsRaw, isLoading: urgencyOfferLoading } = useQuery<UrgencyOfferSettings[]>({
    queryKey: ["/api/urgency-offer-settings"],
  });
  const urgencyOfferSettings = urgencyCampaignsRaw?.[0] as UrgencyOfferSettings | undefined;

  const updateUrgencyOfferMutation = useMutation({
    mutationFn: async (data: Partial<UrgencyOfferSettings>) => {
      if (!urgencyOfferSettings?.id) return;
      return await apiRequest("PUT", `/api/urgency-offer-settings/${urgencyOfferSettings.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/urgency-offer-settings"] });
      toast({
        title: "Success",
        description: "Urgency offer settings updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update urgency offer settings",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (exitIntentSettings) {
      setExitIntentForm({
        isEnabled: exitIntentSettings.isEnabled,
        requireCartItems: exitIntentSettings.requireCartItems,
        mobileExitEnabled: exitIntentSettings.mobileExitEnabled ?? true,
        discountPercentage: exitIntentSettings.discountPercentage,
        discountMessage: exitIntentSettings.discountMessage,
        cooldownMinutes: exitIntentSettings.cooldownMinutes,
        expiryMinutes: exitIntentSettings.expiryMinutes,
        maxUsesPerVisitor: exitIntentSettings.maxUsesPerVisitor,
      });
    }
  }, [exitIntentSettings]);

  useEffect(() => {
    if (idleTimeoutSettings) {
      setIdleTimeoutForm({
        isEnabled: idleTimeoutSettings.isEnabled,
        idleTimeoutSeconds: idleTimeoutSettings.idleTimeoutSeconds,
        requireCartItems: idleTimeoutSettings.requireCartItems,
        discountPercentage: idleTimeoutSettings.discountPercentage,
        discountMessage: idleTimeoutSettings.discountMessage,
        cooldownMinutes: idleTimeoutSettings.cooldownMinutes,
        expiryMinutes: idleTimeoutSettings.expiryMinutes,
        maxUsesPerVisitor: idleTimeoutSettings.maxUsesPerVisitor,
      });
    }
  }, [idleTimeoutSettings]);

  useEffect(() => {
    if (urgencyOfferSettings) {
      setUrgencyOfferForm({
        isEnabled: urgencyOfferSettings.isEnabled,
        countdownDurationMinutes: urgencyOfferSettings.countdownDurationMinutes,
        discountType: urgencyOfferSettings.discountType,
        discountValue: urgencyOfferSettings.discountValue,
        headline: urgencyOfferSettings.headline,
        description: urgencyOfferSettings.description,
        ctaButtonText: urgencyOfferSettings.ctaButtonText,
        dismissButtonText: urgencyOfferSettings.dismissButtonText,
        successMessage: urgencyOfferSettings.successMessage,
        phoneInputLabel: urgencyOfferSettings.phoneInputLabel,
        phoneInputPlaceholder: urgencyOfferSettings.phoneInputPlaceholder,
        requirePhone: urgencyOfferSettings.requirePhone,
        intentThreshold: urgencyOfferSettings.intentThreshold,
        minMessagesBeforeTrigger: urgencyOfferSettings.minMessagesBeforeTrigger,
        maxOffersPerVisitor: urgencyOfferSettings.maxOffersPerVisitor,
        cooldownMinutes: urgencyOfferSettings.cooldownMinutes,
        showReminderAfterDismiss: urgencyOfferSettings.showReminderAfterDismiss,
      });
    }
  }, [urgencyOfferSettings]);

  const resetForm = () => {
    setFormData({
      productId: "site-wide",
      intentThreshold: 70,
      discountPercentage: 10,
      discountMessage: "Hey! I noticed you're interested in {product}. Here's a special {discount}% off just for you!",
      cooldownMinutes: 1440,
      maxUsesPerVisitor: 1,
      expiryMinutes: 60,
      isActive: true,
    });
  };

  const handleOpenCreate = () => {
    resetForm();
    setEditingRule(null);
    setIsCreateDialogOpen(true);
  };

  const handleOpenEdit = (rule: DiscountRule) => {
    setFormData({
      productId: rule.productId || "site-wide",
      intentThreshold: rule.intentThreshold,
      discountPercentage: rule.discountPercentage,
      discountMessage: rule.discountMessage,
      cooldownMinutes: rule.cooldownMinutes,
      maxUsesPerVisitor: rule.maxUsesPerVisitor,
      expiryMinutes: rule.expiryMinutes,
      isActive: rule.isActive,
    });
    setEditingRule(rule);
    setIsCreateDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const payload = {
      productId: formData.productId === "site-wide" ? null : formData.productId,
      intentThreshold: formData.intentThreshold,
      discountPercentage: formData.discountPercentage,
      discountMessage: formData.discountMessage,
      cooldownMinutes: formData.cooldownMinutes,
      maxUsesPerVisitor: formData.maxUsesPerVisitor,
      expiryMinutes: formData.expiryMinutes,
      isActive: formData.isActive,
    };

    if (editingRule) {
      updateRuleMutation.mutate({ id: editingRule.id, data: payload });
    } else {
      createRuleMutation.mutate(payload);
    }
  };

  const handleDelete = (id: string) => {
    setRuleToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (ruleToDelete) {
      deleteRuleMutation.mutate(ruleToDelete);
    }
    setDeleteDialogOpen(false);
    setRuleToDelete(null);
  };

  const getPreviewMessage = () => {
    const selectedProduct = products.find(p => p.id === formData.productId);
    const productName = formData.productId === "site-wide" 
      ? "our product" 
      : (selectedProduct?.name || "our product");
    return formData.discountMessage
      .replace('{product}', productName)
      .replace('{discount}', formData.discountPercentage.toString());
  };

  const getSiteWideRules = () => rules.filter(r => !r.productId);
  const getProductRules = () => rules.filter(r => r.productId);

  if (productsLoading || rulesLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const summary = analyticsData?.summary || {
    totalOffers: 0,
    redeemedOffers: 0,
    redemptionRate: 0,
    totalRevenue: 0,
    avgOrderValue: 0,
  };

  const byProduct = analyticsData?.byProduct || [];
  const timeSeries = analyticsData?.timeSeries || [];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              {showAnalytics ? <BarChart3 className="w-5 h-5 text-white" /> : <Sparkles className="w-5 h-5 text-white" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold">
                  {showAnalytics ? "Discount Analytics" : "Smart Discounts"}
                </h1>
                {!showAnalytics && (
                  <button
                    onClick={() => setShowHelpDialog(true)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Learn how Smart Discounts works"
                  >
                    <HelpCircle className="w-5 h-5" />
                  </button>
                )}
              </div>
              <p className="text-muted-foreground">
                {showAnalytics 
                  ? "Track performance of your smart discount campaigns" 
                  : "Trigger personalized discount offers based on visitor behavior"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {showAnalytics ? (
              <>
                <Select value={dateRange} onValueChange={setDateRange}>
                  <SelectTrigger className="w-[180px]">
                    <Calendar className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Select period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={() => setShowAnalytics(false)} variant="outline">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Rules
                </Button>
              </>
            ) : (
              <Button onClick={() => setShowAnalytics(true)} variant="outline">
                <BarChart3 className="w-4 h-4 mr-2" />
                View Analytics
              </Button>
            )}
          </div>
        </div>
      </div>

      {!showAnalytics && (
        <Alert className="mb-6 border-purple-200 bg-purple-50 dark:bg-purple-950/20">
          <InfoIcon className="h-4 w-4 text-purple-600" />
          <AlertDescription className="text-sm">
            Smart Discounts automatically detects when visitors show high purchase intent (browsing products, scrolling, returning)
            and triggers personalized discount offers through your chatbot. Configure rules below to control when and how discounts are offered.
          </AlertDescription>
        </Alert>
      )}

      {showAnalytics ? (
        analyticsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Offers Sent</CardTitle>
                  <Gift className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary.totalOffers.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">
                    Discount nudges delivered
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Redemption Rate</CardTitle>
                  <Target className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{summary.redemptionRate.toFixed(1)}%</div>
                  <p className="text-xs text-muted-foreground">
                    {summary.redeemedOffers} of {summary.totalOffers} redeemed
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">₹{summary.totalRevenue.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">
                    From discount redemptions
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Order Value</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">₹{summary.avgOrderValue.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground">
                    Per redeemed offer
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <Card>
                <CardHeader>
                  <CardTitle>Offers Over Time</CardTitle>
                  <CardDescription>Daily discount offer activity</CardDescription>
                </CardHeader>
                <CardContent>
                  {timeSeries.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No data available for the selected period</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={timeSeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="date" 
                          tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        />
                        <YAxis />
                        <Tooltip 
                          labelFormatter={(label) => new Date(label).toLocaleDateString()}
                        />
                        <Legend />
                        <Line 
                          type="monotone" 
                          dataKey="offers" 
                          stroke="#8b5cf6" 
                          name="Offers Sent"
                          strokeWidth={2}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="redeemed" 
                          stroke="#10b981" 
                          name="Redeemed"
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Revenue by Day</CardTitle>
                  <CardDescription>Daily revenue from discount redemptions</CardDescription>
                </CardHeader>
                <CardContent>
                  {timeSeries.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No revenue data available</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={timeSeries}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="date" 
                          tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        />
                        <YAxis />
                        <Tooltip 
                          labelFormatter={(label) => new Date(label).toLocaleDateString()}
                          formatter={(value: number) => `₹${value.toFixed(2)}`}
                        />
                        <Legend />
                        <Bar dataKey="revenue" fill="#3b82f6" name="Revenue (₹)" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Performance by Product</CardTitle>
                <CardDescription>
                  See which products generate the most discount offers and conversions
                </CardDescription>
              </CardHeader>
              <CardContent>
                {byProduct.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Gift className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No product data available</p>
                    <p className="text-sm">Start sending discount offers to see analytics</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Offers Sent</TableHead>
                        <TableHead className="text-right">Redeemed</TableHead>
                        <TableHead className="text-right">Redemption Rate</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byProduct.map((product) => {
                        const redemptionRate = product.totalOffers > 0 
                          ? (product.redeemed / product.totalOffers) * 100 
                          : 0;
                        
                        return (
                          <TableRow key={product.productId}>
                            <TableCell className="font-medium">
                              {product.productName}
                            </TableCell>
                            <TableCell className="text-right">
                              {product.totalOffers}
                            </TableCell>
                            <TableCell className="text-right">
                              {product.redeemed}
                            </TableCell>
                            <TableCell className="text-right">
                              <Badge 
                                variant={redemptionRate > 15 ? "default" : "secondary"}
                              >
                                {redemptionRate.toFixed(1)}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              ₹{product.revenue.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )
      ) : (
        <div className="grid gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Site-Wide Default Rules</CardTitle>
              <CardDescription>
                Fallback discounts that apply to all products when no product-specific rule exists
              </CardDescription>
            </div>
            <Button onClick={handleOpenCreate} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Create Rule
            </Button>
          </CardHeader>
          <CardContent>
            {getSiteWideRules().length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Gift className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No site-wide rules configured</p>
                <p className="text-sm">Create a rule without selecting a product to set site-wide defaults</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Intent Threshold
                        <button
                          onClick={() => setShowIntentScoreDialog(true)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="How intent scores are calculated"
                        >
                          <InfoIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead>Cooldown</TableHead>
                    <TableHead>Expires In</TableHead>
                    <TableHead>Max Uses</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getSiteWideRules().map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Target className="w-4 h-4 text-purple-500" />
                          {rule.intentThreshold}%
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          <Percent className="w-3 h-3 mr-1" />
                          {rule.discountPercentage}% OFF
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {rule.cooldownMinutes >= 1440 
                            ? `${Math.floor(rule.cooldownMinutes / 1440)}d` 
                            : `${rule.cooldownMinutes}m`}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {rule.expiryMinutes}m
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {rule.maxUsesPerVisitor}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={rule.isActive}
                          onCheckedChange={(checked) =>
                            toggleRuleMutation.mutate({ id: rule.id, isActive: checked })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenEdit(rule)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(rule.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Product-Specific Rules</CardTitle>
            <CardDescription>
              Custom discount rules for individual products (overrides site-wide defaults)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {getProductRules().length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No product-specific rules configured</p>
                <p className="text-sm">Create targeted discounts for specific products to boost conversions</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        Intent Threshold
                        <button
                          onClick={() => setShowIntentScoreDialog(true)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="How intent scores are calculated"
                        >
                          <InfoIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead>Cooldown</TableHead>
                    <TableHead>Expires In</TableHead>
                    <TableHead>Max Uses</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getProductRules().map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">{rule.productName || 'Unknown Product'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Target className="w-4 h-4 text-purple-500" />
                          {rule.intentThreshold}%
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          <Percent className="w-3 h-3 mr-1" />
                          {rule.discountPercentage}% OFF
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {rule.cooldownMinutes >= 1440 
                            ? `${Math.floor(rule.cooldownMinutes / 1440)}d` 
                            : `${rule.cooldownMinutes}m`}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {rule.expiryMinutes}m
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {rule.maxUsesPerVisitor}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={rule.isActive}
                          onCheckedChange={(checked) =>
                            toggleRuleMutation.mutate({ id: rule.id, isActive: checked })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenEdit(rule)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(rule.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                <MousePointerClick className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle>Exit Intent Detection</CardTitle>
                <CardDescription>
                  Trigger a discount when visitors move their mouse towards closing the tab
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {exitIntentLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between py-4 px-4 bg-muted/50 rounded-lg">
                  <div className="space-y-0.5">
                    <Label htmlFor="exitIntentEnabled" className="text-base font-medium">
                      Enable Exit Intent
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Show a discount when visitors are about to leave
                    </p>
                  </div>
                  <Switch
                    id="exitIntentEnabled"
                    checked={exitIntentForm.isEnabled}
                    onCheckedChange={(checked) => {
                      setExitIntentForm({ ...exitIntentForm, isEnabled: checked });
                      updateExitIntentMutation.mutate({ isEnabled: checked });
                    }}
                  />
                </div>

                {exitIntentForm.isEnabled && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-3 px-4 border rounded-lg">
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <Label htmlFor="exitRequireCart" className="text-sm font-medium">
                            Require Cart Items
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Only show to visitors with items in cart
                          </p>
                        </div>
                      </div>
                      <Switch
                        id="exitRequireCart"
                        checked={exitIntentForm.requireCartItems}
                        onCheckedChange={(checked) =>
                          setExitIntentForm({ ...exitIntentForm, requireCartItems: checked })
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between py-3 px-4 border rounded-lg">
                      <div className="flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <Label htmlFor="exitMobileEnabled" className="text-sm font-medium">
                            Mobile Exit Detection
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Detect when mobile users switch tabs or press back
                          </p>
                        </div>
                      </div>
                      <Switch
                        id="exitMobileEnabled"
                        checked={exitIntentForm.mobileExitEnabled}
                        onCheckedChange={(checked) =>
                          setExitIntentForm({ ...exitIntentForm, mobileExitEnabled: checked })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Discount Percentage: {exitIntentForm.discountPercentage}%</Label>
                      <Slider
                        value={[exitIntentForm.discountPercentage]}
                        onValueChange={([value]) =>
                          setExitIntentForm({ ...exitIntentForm, discountPercentage: value })
                        }
                        min={5}
                        max={50}
                        step={5}
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="exitMessage">Discount Message</Label>
                      <Textarea
                        id="exitMessage"
                        value={exitIntentForm.discountMessage}
                        onChange={(e) =>
                          setExitIntentForm({ ...exitIntentForm, discountMessage: e.target.value })
                        }
                        placeholder="Use {discount} for the discount percentage"
                        rows={2}
                      />
                      <p className="text-xs text-muted-foreground">
                        Preview: {exitIntentForm.discountMessage.replace('{discount}', exitIntentForm.discountPercentage.toString())}
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="exitCooldown">Cooldown (min)</Label>
                        <Input
                          id="exitCooldown"
                          type="number"
                          min={1}
                          value={exitIntentForm.cooldownMinutes}
                          onChange={(e) =>
                            setExitIntentForm({ ...exitIntentForm, cooldownMinutes: parseInt(e.target.value) })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="exitExpiry">Expiry (min)</Label>
                        <Input
                          id="exitExpiry"
                          type="number"
                          min={5}
                          value={exitIntentForm.expiryMinutes}
                          onChange={(e) =>
                            setExitIntentForm({ ...exitIntentForm, expiryMinutes: parseInt(e.target.value) })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="exitMaxUses">Max Uses</Label>
                        <Input
                          id="exitMaxUses"
                          type="number"
                          min={1}
                          value={exitIntentForm.maxUsesPerVisitor}
                          onChange={(e) =>
                            setExitIntentForm({ ...exitIntentForm, maxUsesPerVisitor: parseInt(e.target.value) })
                          }
                        />
                      </div>
                    </div>

                    <Button
                      onClick={() => updateExitIntentMutation.mutate(exitIntentForm)}
                      disabled={updateExitIntentMutation.isPending}
                      className="w-full"
                    >
                      {updateExitIntentMutation.isPending && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      <Save className="w-4 h-4 mr-2" />
                      Save Exit Intent Settings
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                <Timer className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle>Idle Timeout Detection</CardTitle>
                <CardDescription>
                  Trigger a discount when visitors are inactive for a period of time
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {idleTimeoutLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between py-4 px-4 bg-muted/50 rounded-lg">
                  <div className="space-y-0.5">
                    <Label htmlFor="idleTimeoutEnabled" className="text-base font-medium">
                      Enable Idle Timeout
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Show a discount when visitors are inactive
                    </p>
                  </div>
                  <Switch
                    id="idleTimeoutEnabled"
                    checked={idleTimeoutForm.isEnabled}
                    onCheckedChange={(checked) => {
                      setIdleTimeoutForm({ ...idleTimeoutForm, isEnabled: checked });
                      updateIdleTimeoutMutation.mutate({ isEnabled: checked });
                    }}
                  />
                </div>

                {idleTimeoutForm.isEnabled && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Idle Timeout: {idleTimeoutForm.idleTimeoutSeconds} seconds</Label>
                      <Slider
                        value={[idleTimeoutForm.idleTimeoutSeconds]}
                        onValueChange={([value]) =>
                          setIdleTimeoutForm({ ...idleTimeoutForm, idleTimeoutSeconds: value })
                        }
                        min={10}
                        max={300}
                        step={5}
                        className="w-full"
                      />
                      <p className="text-xs text-muted-foreground">
                        Time of inactivity before showing the discount (10-300 seconds)
                      </p>
                    </div>

                    <div className="flex items-center justify-between py-3 px-4 border rounded-lg">
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <Label htmlFor="idleRequireCart" className="text-sm font-medium">
                            Require Cart Items
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Only show to visitors with items in cart
                          </p>
                        </div>
                      </div>
                      <Switch
                        id="idleRequireCart"
                        checked={idleTimeoutForm.requireCartItems}
                        onCheckedChange={(checked) =>
                          setIdleTimeoutForm({ ...idleTimeoutForm, requireCartItems: checked })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Discount Percentage: {idleTimeoutForm.discountPercentage}%</Label>
                      <Slider
                        value={[idleTimeoutForm.discountPercentage]}
                        onValueChange={([value]) =>
                          setIdleTimeoutForm({ ...idleTimeoutForm, discountPercentage: value })
                        }
                        min={5}
                        max={50}
                        step={5}
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="idleMessage">Discount Message</Label>
                      <Textarea
                        id="idleMessage"
                        value={idleTimeoutForm.discountMessage}
                        onChange={(e) =>
                          setIdleTimeoutForm({ ...idleTimeoutForm, discountMessage: e.target.value })
                        }
                        placeholder="Use {discount} for the discount percentage"
                        rows={2}
                      />
                      <p className="text-xs text-muted-foreground">
                        Preview: {idleTimeoutForm.discountMessage.replace('{discount}', idleTimeoutForm.discountPercentage.toString())}
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="idleCooldown">Cooldown (min)</Label>
                        <Input
                          id="idleCooldown"
                          type="number"
                          min={1}
                          value={idleTimeoutForm.cooldownMinutes}
                          onChange={(e) =>
                            setIdleTimeoutForm({ ...idleTimeoutForm, cooldownMinutes: parseInt(e.target.value) })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="idleExpiry">Expiry (min)</Label>
                        <Input
                          id="idleExpiry"
                          type="number"
                          min={5}
                          value={idleTimeoutForm.expiryMinutes}
                          onChange={(e) =>
                            setIdleTimeoutForm({ ...idleTimeoutForm, expiryMinutes: parseInt(e.target.value) })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="idleMaxUses">Max Uses</Label>
                        <Input
                          id="idleMaxUses"
                          type="number"
                          min={1}
                          value={idleTimeoutForm.maxUsesPerVisitor}
                          onChange={(e) =>
                            setIdleTimeoutForm({ ...idleTimeoutForm, maxUsesPerVisitor: parseInt(e.target.value) })
                          }
                        />
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={() => updateIdleTimeoutMutation.mutate(idleTimeoutForm)}
                        disabled={updateIdleTimeoutMutation.isPending}
                        className="flex-1"
                      >
                        {updateIdleTimeoutMutation.isPending && (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        )}
                        <Save className="w-4 h-4 mr-2" />
                        Save Idle Timeout Settings
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const discountMessage = (idleTimeoutForm.discountMessage || "Still thinking? Here's {discount}% off!")
                            .replace('{discount}', String(idleTimeoutForm.discountPercentage || 10));
                          if (publicChatLink?.token) {
                            window.open(`/public-chat/${publicChatLink.token}?test_discount=${encodeURIComponent(discountMessage)}&discount_pct=${idleTimeoutForm.discountPercentage}&expiry_min=${idleTimeoutForm.expiryMinutes}`, '_blank');
                          } else {
                            toast({
                              title: "Error",
                              description: "No demo link available. Please create a public chat link first.",
                              variant: "destructive",
                            });
                          }
                        }}
                        className="shrink-0"
                      >
                        <Play className="w-4 h-4 mr-2" />
                        Test
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle>AI Intent-Based Urgency Offers</CardTitle>
                <CardDescription>
                  Trigger limited-time discounts when AI detects high purchase intent in conversations
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {urgencyOfferLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between py-4 px-4 bg-muted/50 rounded-lg">
                  <div className="space-y-0.5">
                    <Label htmlFor="urgencyOfferEnabled" className="text-base font-medium">
                      Enable Urgency Offers
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Show countdown discount offers to high-intent visitors
                    </p>
                  </div>
                  <Switch
                    id="urgencyOfferEnabled"
                    checked={urgencyOfferForm.isEnabled}
                    onCheckedChange={(checked) => {
                      setUrgencyOfferForm({ ...urgencyOfferForm, isEnabled: checked });
                      updateUrgencyOfferMutation.mutate({ isEnabled: checked });
                    }}
                  />
                </div>

                {urgencyOfferForm.isEnabled && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Countdown Duration</Label>
                        <Select
                          value={String(urgencyOfferForm.countdownDurationMinutes)}
                          onValueChange={(value) =>
                            setUrgencyOfferForm({ ...urgencyOfferForm, countdownDurationMinutes: parseInt(value) })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="5">5 minutes</SelectItem>
                            <SelectItem value="10">10 minutes</SelectItem>
                            <SelectItem value="15">15 minutes</SelectItem>
                            <SelectItem value="30">30 minutes</SelectItem>
                            <SelectItem value="60">1 hour</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Discount Type</Label>
                        <Select
                          value={urgencyOfferForm.discountType}
                          onValueChange={(value) =>
                            setUrgencyOfferForm({ ...urgencyOfferForm, discountType: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentage">Percentage (%)</SelectItem>
                            <SelectItem value="fixed">Fixed Amount</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Discount Value: {urgencyOfferForm.discountValue}{urgencyOfferForm.discountType === 'percentage' ? '%' : ''}</Label>
                      <Slider
                        value={[urgencyOfferForm.discountValue]}
                        onValueChange={([value]) =>
                          setUrgencyOfferForm({ ...urgencyOfferForm, discountValue: value })
                        }
                        min={5}
                        max={urgencyOfferForm.discountType === 'percentage' ? 50 : 100}
                        step={5}
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-4 p-4 border rounded-lg">
                      <h4 className="font-medium text-sm">Offer Text Customization</h4>
                      <div className="space-y-2">
                        <Label htmlFor="urgencyHeadline">Headline</Label>
                        <Input
                          id="urgencyHeadline"
                          value={urgencyOfferForm.headline}
                          onChange={(e) =>
                            setUrgencyOfferForm({ ...urgencyOfferForm, headline: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="urgencyDescription">Description</Label>
                        <Textarea
                          id="urgencyDescription"
                          value={urgencyOfferForm.description}
                          onChange={(e) =>
                            setUrgencyOfferForm({ ...urgencyOfferForm, description: e.target.value })
                          }
                          rows={2}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="urgencyCta">Button Text</Label>
                          <Input
                            id="urgencyCta"
                            value={urgencyOfferForm.ctaButtonText}
                            onChange={(e) =>
                              setUrgencyOfferForm({ ...urgencyOfferForm, ctaButtonText: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="urgencyDismiss">Dismiss Text</Label>
                          <Input
                            id="urgencyDismiss"
                            value={urgencyOfferForm.dismissButtonText}
                            onChange={(e) =>
                              setUrgencyOfferForm({ ...urgencyOfferForm, dismissButtonText: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 p-4 border rounded-lg">
                      <h4 className="font-medium text-sm">Phone Capture Settings</h4>
                      <div className="flex items-center justify-between">
                        <div>
                          <Label htmlFor="requirePhone" className="text-sm">Require Phone Number</Label>
                          <p className="text-xs text-muted-foreground">User must enter phone to claim offer</p>
                        </div>
                        <Switch
                          id="requirePhone"
                          checked={urgencyOfferForm.requirePhone}
                          onCheckedChange={(checked) =>
                            setUrgencyOfferForm({ ...urgencyOfferForm, requirePhone: checked })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phoneLabel">Phone Input Label</Label>
                        <Input
                          id="phoneLabel"
                          value={urgencyOfferForm.phoneInputLabel}
                          onChange={(e) =>
                            setUrgencyOfferForm({ ...urgencyOfferForm, phoneInputLabel: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="successMessage">Success Message</Label>
                        <Textarea
                          id="successMessage"
                          value={urgencyOfferForm.successMessage}
                          onChange={(e) =>
                            setUrgencyOfferForm({ ...urgencyOfferForm, successMessage: e.target.value })
                          }
                          rows={2}
                        />
                      </div>
                    </div>

                    <div className="space-y-4 p-4 border rounded-lg">
                      <h4 className="font-medium text-sm">AI Intent Detection</h4>
                      <div className="space-y-2">
                        <Label>Intent Threshold: {urgencyOfferForm.intentThreshold}%</Label>
                        <Slider
                          value={[urgencyOfferForm.intentThreshold]}
                          onValueChange={([value]) =>
                            setUrgencyOfferForm({ ...urgencyOfferForm, intentThreshold: value })
                          }
                          min={50}
                          max={95}
                          step={5}
                          className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">
                          Higher values = more confident intent required before showing offer
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label>Minimum Messages: {urgencyOfferForm.minMessagesBeforeTrigger}</Label>
                        <Slider
                          value={[urgencyOfferForm.minMessagesBeforeTrigger]}
                          onValueChange={([value]) =>
                            setUrgencyOfferForm({ ...urgencyOfferForm, minMessagesBeforeTrigger: value })
                          }
                          min={2}
                          max={10}
                          step={1}
                          className="w-full"
                        />
                        <p className="text-xs text-muted-foreground">
                          Wait for at least this many messages before detecting intent
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="cooldownMinutes">Cooldown (minutes)</Label>
                        <Input
                          id="cooldownMinutes"
                          type="number"
                          min={1}
                          max={1440}
                          value={urgencyOfferForm.cooldownMinutes}
                          onChange={(e) =>
                            setUrgencyOfferForm({ ...urgencyOfferForm, cooldownMinutes: parseInt(e.target.value) || 30 })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="maxOffers">Max Offers Per Visitor</Label>
                        <Input
                          id="maxOffers"
                          type="number"
                          min={1}
                          max={5}
                          value={urgencyOfferForm.maxOffersPerVisitor}
                          onChange={(e) =>
                            setUrgencyOfferForm({ ...urgencyOfferForm, maxOffersPerVisitor: parseInt(e.target.value) })
                          }
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between py-3 px-4 border rounded-lg">
                      <div>
                        <Label htmlFor="showReminder" className="text-sm">Show Reminder After Dismiss</Label>
                        <p className="text-xs text-muted-foreground">Show subtle badge if user dismisses offer</p>
                      </div>
                      <Switch
                        id="showReminder"
                        checked={urgencyOfferForm.showReminderAfterDismiss}
                        onCheckedChange={(checked) =>
                          setUrgencyOfferForm({ ...urgencyOfferForm, showReminderAfterDismiss: checked })
                        }
                      />
                    </div>

                    <Button
                      onClick={() => updateUrgencyOfferMutation.mutate(urgencyOfferForm)}
                      disabled={updateUrgencyOfferMutation.isPending}
                      className="w-full"
                    >
                      {updateUrgencyOfferMutation.isPending && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      <Save className="w-4 h-4 mr-2" />
                      Save Urgency Offer Settings
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
      )}

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? "Edit Discount Rule" : "Create Discount Rule"}
            </DialogTitle>
            <DialogDescription>
              Configure when and how discount offers should be triggered for visitors
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="product">Product (Optional)</Label>
              <Select
                value={formData.productId}
                onValueChange={(value) => setFormData({ ...formData, productId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a product or leave empty for site-wide" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="site-wide">Site-Wide (All Products)</SelectItem>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Leave empty to create a site-wide default rule
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="intentThreshold">
                Intent Threshold: {formData.intentThreshold}%
              </Label>
              <Slider
                id="intentThreshold"
                min={50}
                max={100}
                step={5}
                value={[formData.intentThreshold]}
                onValueChange={([value]) =>
                  setFormData({ ...formData, intentThreshold: value })
                }
              />
              <p className="text-xs text-muted-foreground">
                Trigger discount when visitor's purchase intent score reaches this threshold
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="discountPercentage">
                Discount Percentage: {formData.discountPercentage}%
              </Label>
              <Slider
                id="discountPercentage"
                min={5}
                max={50}
                step={5}
                value={[formData.discountPercentage]}
                onValueChange={([value]) =>
                  setFormData({ ...formData, discountPercentage: value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="discountMessage">Discount Message</Label>
              <Textarea
                id="discountMessage"
                value={formData.discountMessage}
                onChange={(e) =>
                  setFormData({ ...formData, discountMessage: e.target.value })
                }
                placeholder="Enter the message visitors will see..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Use {"{product}"} and {"{discount}"} placeholders
              </p>
            </div>

            <Alert>
              <Sparkles className="h-4 w-4" />
              <AlertDescription>
                <strong>Preview:</strong> {getPreviewMessage()}
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cooldownMinutes">Cooldown (minutes)</Label>
                <Input
                  id="cooldownMinutes"
                  type="number"
                  min="60"
                  step="60"
                  value={formData.cooldownMinutes}
                  onChange={(e) =>
                    setFormData({ ...formData, cooldownMinutes: parseInt(e.target.value) })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Wait time before showing another discount
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="expiryMinutes">Expires In (minutes)</Label>
                <Input
                  id="expiryMinutes"
                  type="number"
                  min="15"
                  step="15"
                  value={formData.expiryMinutes}
                  onChange={(e) =>
                    setFormData({ ...formData, expiryMinutes: parseInt(e.target.value) })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  How long the discount code is valid
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxUsesPerVisitor">Max Uses Per Visitor</Label>
              <Input
                id="maxUsesPerVisitor"
                type="number"
                min="1"
                max="10"
                value={formData.maxUsesPerVisitor}
                onChange={(e) =>
                  setFormData({ ...formData, maxUsesPerVisitor: parseInt(e.target.value) })
                }
              />
              <p className="text-xs text-muted-foreground">
                Maximum number of times a visitor can receive this discount
              </p>
            </div>

            <div className="flex items-center justify-between py-4 px-4 bg-muted/50 rounded-lg">
              <div className="space-y-0.5">
                <Label htmlFor="isActive" className="text-base">
                  Enable Rule
                </Label>
                <p className="text-sm text-muted-foreground">
                  Activate this discount rule to start offering it to visitors
                </p>
              </div>
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, isActive: checked })
                }
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createRuleMutation.isPending || updateRuleMutation.isPending}
              >
                {(createRuleMutation.isPending || updateRuleMutation.isPending) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                <Save className="w-4 h-4 mr-2" />
                {editingRule ? "Update Rule" : "Create Rule"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Discount Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this discount rule? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRuleToDelete(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showHelpDialog} onOpenChange={setShowHelpDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="w-5 h-5 text-purple-500" />
              How Smart Discounts Works
            </DialogTitle>
            <DialogDescription>
              Automatically convert high-intent visitors into customers with personalized discount offers
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="space-y-3">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Target className="w-4 h-4 text-purple-500" />
                Behavioral Intent Detection
              </h3>
              <p className="text-sm text-muted-foreground">
                Smart Discounts tracks visitor behavior on your website to detect purchase intent. When visitors show high interest 
                (browsing multiple products, scrolling through product pages, returning to your site), the system calculates an 
                "intent score" from 0-100.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Percent className="w-4 h-4 text-purple-500" />
                Rule-Based Discount Triggers
              </h3>
              <p className="text-sm text-muted-foreground">
                You configure rules that define when discounts should be offered. Each rule has an "Intent Threshold" - when a 
                visitor's intent score exceeds this threshold, the chatbot automatically sends them a personalized discount offer.
              </p>
              <ul className="text-sm text-muted-foreground list-disc ml-5 space-y-1">
                <li><strong>Site-Wide Rules:</strong> Apply to all products when no product-specific rule exists</li>
                <li><strong>Product-Specific Rules:</strong> Target individual products with custom discounts</li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Gift className="w-4 h-4 text-purple-500" />
                Personalized Chatbot Nudges
              </h3>
              <p className="text-sm text-muted-foreground">
                When triggered, your AI chatbot delivers the discount message naturally in the conversation. The message includes 
                a unique discount code that the visitor can use at checkout.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Clock className="w-4 h-4 text-purple-500" />
                Smart Cooldowns & Limits
              </h3>
              <p className="text-sm text-muted-foreground">
                To prevent spam, each rule has configurable limits:
              </p>
              <ul className="text-sm text-muted-foreground list-disc ml-5 space-y-1">
                <li><strong>Cooldown Period:</strong> Time before the same visitor can receive another offer</li>
                <li><strong>Max Uses:</strong> Maximum offers per visitor</li>
                <li><strong>Expiry:</strong> How long the discount code remains valid</li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-500" />
                Track Performance
              </h3>
              <p className="text-sm text-muted-foreground">
                Use the "View Analytics" button to monitor your discount campaigns. See how many offers were sent, 
                redemption rates, revenue generated, and which products perform best.
              </p>
            </div>

            <div className="bg-purple-50 dark:bg-purple-950/20 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
              <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                Pro Tip: Start with a higher intent threshold (80+) and lower discount (5-10%) to target your most interested 
                visitors without giving away too much margin.
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => setShowHelpDialog(false)}>
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showIntentScoreDialog} onOpenChange={setShowIntentScoreDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Target className="w-5 h-5 text-purple-500" />
              How Intent Scores Are Calculated
            </DialogTitle>
            <DialogDescription>
              Visitor actions are tracked and scored to measure purchase intent
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Each visitor action on your website adds points to their intent score. Higher scores indicate 
              stronger purchase intent. The score is capped at 100.
            </p>

            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Scoring Weights</h4>
              <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Page View</span>
                  <span className="font-medium text-purple-600">+5 points</span>
                </div>
                <div className="flex justify-between">
                  <span>Product View</span>
                  <span className="font-medium text-purple-600">+10 points</span>
                </div>
                <div className="flex justify-between">
                  <span>Scroll Depth 50%</span>
                  <span className="font-medium text-purple-600">+5 points</span>
                </div>
                <div className="flex justify-between">
                  <span>Scroll Depth 75%</span>
                  <span className="font-medium text-purple-600">+10 points</span>
                </div>
                <div className="flex justify-between">
                  <span>Click</span>
                  <span className="font-medium text-purple-600">+15 points</span>
                </div>
                <div className="flex justify-between">
                  <span>Add to Cart</span>
                  <span className="font-medium text-purple-600">+25 points</span>
                </div>
                <div className="flex justify-between">
                  <span>Return Visit</span>
                  <span className="font-medium text-purple-600">+20 points</span>
                </div>
                <div className="flex justify-between">
                  <span>Dwell Time (30+ seconds)</span>
                  <span className="font-medium text-purple-600">+10 points</span>
                </div>
                <div className="flex justify-between">
                  <span>Dwell Time (60+ seconds)</span>
                  <span className="font-medium text-purple-600">+20 points</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Intent Levels</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-gray-100 dark:bg-gray-800">0-25</Badge>
                  <span className="text-muted-foreground">Low</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-yellow-100 dark:bg-yellow-900/30">26-50</Badge>
                  <span className="text-muted-foreground">Medium</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-orange-100 dark:bg-orange-900/30">51-75</Badge>
                  <span className="text-muted-foreground">High</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-green-100 dark:bg-green-900/30">76-100</Badge>
                  <span className="text-muted-foreground">Very High</span>
                </div>
              </div>
            </div>

            <div className="bg-purple-50 dark:bg-purple-950/20 p-3 rounded-lg border border-purple-200 dark:border-purple-800">
              <p className="text-xs text-purple-700 dark:text-purple-300">
                <strong>Example:</strong> A visitor who views 2 products (+20), scrolls to 75% (+10), 
                spends 45 seconds on a page (+10), and clicks on a feature (+15) would have an intent 
                score of 55 (High).
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => setShowIntentScoreDialog(false)}>
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
