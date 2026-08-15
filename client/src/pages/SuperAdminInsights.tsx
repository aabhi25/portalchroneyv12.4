import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Building2, Users, MessageSquare, Contact, Package, FileQuestion, Clock, TrendingUp, Sparkles, LucideIcon, Search, X, Check, Calendar, ChevronDown } from "lucide-react";
import { format, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { useState, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";

type DateFilterType = "today" | "yesterday" | "last7days" | "lastMonth" | "custom" | "lifetime";

interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  iconColor: string;
}

function StatCard({ icon: Icon, label, value, iconColor }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2 md:pb-3">
        <CardTitle className="text-xs md:text-sm font-medium text-gray-600">
          <div className="flex items-center gap-2 h-5">
            <Icon className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
            <span className="truncate leading-tight">{label}</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xl md:text-2xl font-bold text-gray-900">{value}</div>
      </CardContent>
    </Card>
  );
}

interface BusinessUser {
  id: string;
  username: string;
  lastLoginAt: string | null;
  createdAt: string;
}

interface BusinessAnalytics {
  id: string;
  name: string;
  website: string;
  status: string;
  createdAt: string;
  userCount: number;
  lastLogin: string | null;
  users: BusinessUser[];
  leadCount: number;
  conversationCount: number;
  productCount: number;
  faqCount: number;
}

interface BusinessAccount {
  id: string;
  name: string;
  website: string;
}

const dateFilterOptions: { value: DateFilterType; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7days", label: "Last 7 Days" },
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
    case "lastMonth":
      const lastMonth = subMonths(now, 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    case "lifetime":
    default:
      return { from: undefined, to: undefined };
  }
}

export default function SuperAdminInsights() {
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilterType>("lifetime");
  const [customDateRange, setCustomDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isDateFilterOpen, setIsDateFilterOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Calculate effective date range based on filter type
  const effectiveDateRange = useMemo(() => {
    if (dateFilter === "custom") {
      return customDateRange;
    }
    return getDateRangeForFilter(dateFilter);
  }, [dateFilter, customDateRange]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch all business accounts for the search
  const { data: businessAccounts = [] } = useQuery<BusinessAccount[]>({
    queryKey: ["/api/business-accounts", "all"],
    queryFn: async () => {
      const response = await fetch("/api/business-accounts?limit=1000", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch business accounts");
      }
      const data = await response.json();
      // API returns { accounts: [...], total, hasMore } - extract accounts array
      return data.accounts || data;
    },
  });

  // Filter business accounts based on search query
  const filteredAccounts = businessAccounts
    .filter(account => 
      account.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      account.website.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Get selected business name
  const selectedBusiness = businessAccounts.find(b => b.id === selectedBusinessId);

  // Fetch analytics for selected business only
  const { data: analytics = [], isLoading, isError, error, refetch } = useQuery<BusinessAnalytics[]>({
    queryKey: ["/api/super-admin/insights", selectedBusinessId, effectiveDateRange.from?.toISOString(), effectiveDateRange.to?.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("businessAccountId", selectedBusinessId);
      if (effectiveDateRange.from) {
        params.set("dateFrom", effectiveDateRange.from.toISOString());
      }
      if (effectiveDateRange.to) {
        params.set("dateTo", effectiveDateRange.to.toISOString());
      }
      const url = `/api/super-admin/insights?${params.toString()}`;
      const response = await fetch(url, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch business analytics");
      }
      return response.json();
    },
    enabled: !!selectedBusinessId,
  });

  // Get label for current date filter
  const getDateFilterLabel = () => {
    const option = dateFilterOptions.find(o => o.value === dateFilter);
    if (dateFilter === "custom" && customDateRange.from && customDateRange.to) {
      return `${format(customDateRange.from, "MMM dd")} - ${format(customDateRange.to, "MMM dd, yyyy")}`;
    }
    return option?.label || "Lifetime";
  };

  const handleSelectBusiness = (id: string) => {
    setSelectedBusinessId(id);
    setSearchQuery("");
    setIsDropdownOpen(false);
  };

  const handleClearSelection = () => {
    setSelectedBusinessId("");
    setSearchQuery("");
  };

  // Calculate totals
  const totals = analytics.reduce(
    (acc, business) => ({
      businesses: acc.businesses + 1,
      users: acc.users + business.userCount,
      leads: acc.leads + business.leadCount,
      conversations: acc.conversations + business.conversationCount,
      products: acc.products + business.productCount,
      faqs: acc.faqs + business.faqCount,
    }),
    { businesses: 0, users: 0, leads: 0, conversations: 0, products: 0, faqs: 0 }
  );

  // Stats configuration (removed Users since it's 1:1 with Businesses)
  const statsConfig: StatCardProps[] = [
    { icon: Building2, label: "Businesses", value: totals.businesses, iconColor: "text-blue-600" },
    { icon: Contact, label: "Leads", value: totals.leads, iconColor: "text-green-600" },
    { icon: MessageSquare, label: "Conversations", value: totals.conversations, iconColor: "text-orange-600" },
    { icon: Package, label: "Products", value: totals.products, iconColor: "text-cyan-600" },
    { icon: FileQuestion, label: "FAQs", value: totals.faqs, iconColor: "text-indigo-600" },
  ];

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    try {
      return format(new Date(dateString), "MMM dd, yyyy 'at' hh:mm a");
    } catch {
      return "Invalid date";
    }
  };

  const getLoginStatus = (lastLogin: string | null) => {
    if (!lastLogin) return "text-gray-400";
    const now = new Date().getTime();
    const loginTime = new Date(lastLogin).getTime();
    const hoursSince = (now - loginTime) / (1000 * 60 * 60);
    
    if (hoursSince < 24) return "text-green-600";
    if (hoursSince < 168) return "text-yellow-600";
    return "text-red-600";
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
              <p className="text-[11px] text-white/90 leading-tight mt-0.5">Super Admin Insights</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-gray-50">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
          {/* Page Title */}
          <div className="mb-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-6 h-6 text-purple-600" />
                  <h2 className="text-2xl font-bold text-gray-900">Business Insights</h2>
                </div>
                <p className="text-muted-foreground mt-1">
                  Analytics and activity overview for business accounts
                </p>
              </div>
              
              {/* Business Search Selector */}
              <div className="flex flex-col sm:flex-row gap-4">
                {/* Date Filter */}
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Filter by Date
                  </label>
                  <Popover open={isDateFilterOpen} onOpenChange={setIsDateFilterOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full sm:w-48 justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-gray-500" />
                          <span className="truncate">{getDateFilterLabel()}</span>
                        </div>
                        <ChevronDown className="w-4 h-4 text-gray-500 ml-2 flex-shrink-0" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <div className="p-2 space-y-1">
                        {dateFilterOptions.map((option) => (
                          <button
                            key={option.value}
                            onClick={() => {
                              if (option.value !== "custom") {
                                setDateFilter(option.value);
                                setIsDateFilterOpen(false);
                              } else {
                                setDateFilter("custom");
                              }
                            }}
                            className={cn(
                              "w-full px-3 py-2 text-left text-sm rounded-md hover:bg-gray-100 flex items-center justify-between",
                              dateFilter === option.value && "bg-purple-50 text-purple-700"
                            )}
                          >
                            {option.label}
                            {dateFilter === option.value && (
                              <Check className="w-4 h-4 text-purple-600" />
                            )}
                          </button>
                        ))}
                      </div>
                      {dateFilter === "custom" && (
                        <div className="border-t p-3">
                          <CalendarComponent
                            mode="range"
                            selected={{ from: customDateRange.from, to: customDateRange.to }}
                            onSelect={(range) => {
                              setCustomDateRange({ from: range?.from, to: range?.to });
                              if (range?.from && range?.to) {
                                setIsDateFilterOpen(false);
                              }
                            }}
                            numberOfMonths={1}
                            className="rounded-md"
                          />
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Search Business */}
                <div className="w-full lg:w-72" ref={dropdownRef}>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Search Business Account
                  </label>
                <div className="relative">
                  {selectedBusiness ? (
                    <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-white">
                      <Building2 className="w-4 h-4 text-purple-600 flex-shrink-0" />
                      <span className="flex-1 truncate font-medium">{selectedBusiness.name}</span>
                      <button
                        onClick={handleClearSelection}
                        className="p-1 hover:bg-gray-100 rounded-full"
                      >
                        <X className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        ref={inputRef}
                        type="text"
                        placeholder="Type to search businesses..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setIsDropdownOpen(true);
                        }}
                        onFocus={() => setIsDropdownOpen(true)}
                        className="pl-9"
                      />
                    </>
                  )}
                  
                  {/* Dropdown Results */}
                  {isDropdownOpen && !selectedBusiness && (
                    <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-72 overflow-y-auto">
                      {filteredAccounts.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-gray-500 text-center">
                          {searchQuery ? "No businesses found" : "Start typing to search..."}
                        </div>
                      ) : (
                        filteredAccounts.map((account) => (
                          <button
                            key={account.id}
                            onClick={() => handleSelectBusiness(account.id)}
                            className={cn(
                              "w-full px-4 py-3 text-left hover:bg-purple-50 flex items-center gap-3 border-b last:border-b-0",
                              selectedBusinessId === account.id && "bg-purple-50"
                            )}
                          >
                            <Building2 className="w-4 h-4 text-purple-600 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 truncate">{account.name}</p>
                              <p className="text-xs text-gray-500 truncate">{account.website}</p>
                            </div>
                            {selectedBusinessId === account.id && (
                              <Check className="w-4 h-4 text-purple-600 flex-shrink-0" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
              </div>
            </div>
          </div>

          {/* Error State */}
          {selectedBusinessId && isError && (
            <Card className="mb-6 border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-red-600" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-red-900 mb-1">Failed to Load Analytics</h3>
                    <p className="text-sm text-red-700 mb-4">
                      {error instanceof Error ? error.message : "Unable to fetch business analytics data"}
                    </p>
                    <button
                      onClick={() => refetch()}
                      className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm font-medium"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Loading State */}
          {selectedBusinessId && isLoading && (
            <div className="text-center py-16 mb-6">
              <div className="inline-block w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-lg font-medium text-gray-900 mb-2">Loading Business Analytics</p>
              <p className="text-sm text-gray-600">Gathering data for {selectedBusiness?.name}...</p>
            </div>
          )}

          {/* Summary Cards */}
          {selectedBusinessId && !isLoading && !isError && analytics.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
              {statsConfig.slice(1).map((stat, index) => (
                <StatCard key={index} {...stat} />
              ))}
            </div>
          )}

          {/* No Business Selected State */}
          {!selectedBusinessId && (
            <Card>
              <CardContent className="text-center py-16">
                <Search className="w-12 h-12 text-purple-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Business Account</h3>
                <p className="text-gray-600 max-w-md mx-auto">
                  Use the search box above to find and select a business account to view its analytics and insights.
                </p>
              </CardContent>
            </Card>
          )}

          {/* No Business Accounts Found State */}
          {selectedBusinessId && !isLoading && !isError && analytics.length === 0 && (
            <Card>
              <CardContent className="text-center py-12">
                <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No analytics data found for this business</p>
              </CardContent>
            </Card>
          )}

          {/* Business Analytics Cards */}
          {selectedBusinessId && !isLoading && !isError && analytics.length > 0 && (
            <div className="space-y-6">
              {analytics.map((business) => (
                <Card key={business.id} className="border-l-4 border-l-purple-600">
                  <CardHeader>
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                            <Building2 className="w-5 h-5 text-purple-600" />
                            {business.name}
                          </CardTitle>
                          <Badge 
                            variant={business.status === "active" ? "default" : "secondary"}
                            className={business.status === "active" ? "bg-green-500" : "bg-gray-500"}
                          >
                            {business.status}
                          </Badge>
                        </div>
                        <a 
                          href={business.website} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline mt-1 inline-block break-all"
                        >
                          {business.website}
                        </a>
                        <p className="text-xs text-gray-500 mt-2">
                          Created {formatDate(business.createdAt)}
                        </p>
                      </div>
                      <div className="md:text-right">
                        <div className="flex items-center gap-2 text-sm">
                          <Clock className={`w-4 h-4 ${getLoginStatus(business.lastLogin)}`} />
                          <span className="text-gray-600">Last Activity:</span>
                        </div>
                        <p className={`text-sm font-medium ${getLoginStatus(business.lastLogin)} mt-1`}>
                          {formatDate(business.lastLogin)}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
                      <div className="bg-green-50 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-green-600 mb-1">
                          <Contact className="w-4 h-4" />
                          <span className="text-xs font-medium">Leads</span>
                        </div>
                        <div className="text-2xl font-bold text-green-900">{business.leadCount}</div>
                      </div>

                      <div className="bg-orange-50 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-orange-600 mb-1">
                          <MessageSquare className="w-4 h-4" />
                          <span className="text-xs font-medium">Conversations</span>
                        </div>
                        <div className="text-2xl font-bold text-orange-900">{business.conversationCount}</div>
                      </div>

                      <div className="bg-cyan-50 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-cyan-600 mb-1">
                          <Package className="w-4 h-4" />
                          <span className="text-xs font-medium">Products</span>
                        </div>
                        <div className="text-2xl font-bold text-cyan-900">{business.productCount}</div>
                      </div>

                      <div className="bg-indigo-50 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-indigo-600 mb-1">
                          <FileQuestion className="w-4 h-4" />
                          <span className="text-xs font-medium">FAQs</span>
                        </div>
                        <div className="text-2xl font-bold text-indigo-900">{business.faqCount}</div>
                      </div>
                    </div>

                    {/* User Information (1:1 relationship) */}
                    {business.users.length > 0 && (
                      <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Users className="w-4 h-4 text-purple-600" />
                              <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Account User</p>
                            </div>
                            <p className="font-medium text-gray-900 truncate">{business.users[0].username}</p>
                            <p className="text-xs text-gray-600 mt-1">
                              Joined {formatDate(business.users[0].createdAt)}
                            </p>
                          </div>
                          <div className="sm:text-right flex-shrink-0">
                            <p className="text-xs text-gray-600">Last Login</p>
                            <p className={`text-sm font-medium ${getLoginStatus(business.users[0].lastLoginAt)}`}>
                              {formatDate(business.users[0].lastLoginAt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
