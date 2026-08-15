import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, BarChart3, MessageSquare, Globe, FileText, Image, Mic, Calendar as CalendarIcon, Sparkles, Check, ChevronsUpDown } from "lucide-react";
import { format, subDays } from "date-fns";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface CostByCategory {
  category: string;
  cost: string;
  tokensInput: number;
  tokensOutput: number;
  eventCount: number;
}

interface BusinessCostData {
  businessAccountId: string;
  businessName?: string;
  totalCost: string;
  totalTokensInput: number;
  totalTokensOutput: number;
  eventCount: number;
  byCategory: CostByCategory[];
}

interface BusinessAccount {
  id: string;
  name: string;
  website: string;
}

type DateRangePreset = "today" | "yesterday" | "last_week" | "this_month" | "custom";

export default function SuperAdminCosts() {
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("all");
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>("today");
  const [customDateFrom, setCustomDateFrom] = useState<Date | undefined>(undefined);
  const [customDateTo, setCustomDateTo] = useState<Date | undefined>(undefined);
  const [businessSearchOpen, setBusinessSearchOpen] = useState(false);

  const getDateRange = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let from: Date;
    let to: Date;

    if (dateRangePreset === "custom") {
      from = customDateFrom || new Date(today.getFullYear(), today.getMonth(), 1);
      to = customDateTo || today;
    } else if (dateRangePreset === "today") {
      from = today;
      to = today;
    } else if (dateRangePreset === "yesterday") {
      const yesterday = subDays(today, 1);
      from = yesterday;
      to = yesterday;
    } else if (dateRangePreset === "last_week") {
      from = subDays(today, 7);
      to = today;
    } else if (dateRangePreset === "this_month") {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      to = today;
    } else {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      to = today;
    }

    return {
      from: format(from, "yyyy-MM-dd"),
      to: format(to, "yyyy-MM-dd"),
    };
  };

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

  const { data: costData, isLoading, isError, error, refetch } = useQuery<BusinessCostData | BusinessCostData[]>({
    queryKey: ["/api/super-admin/costs", selectedBusinessId, dateRangePreset, customDateFrom, customDateTo],
    queryFn: async () => {
      const dateRange = getDateRange();
      const params = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to,
      });
      
      if (selectedBusinessId !== "all") {
        params.append("businessAccountId", selectedBusinessId);
      }

      const response = await fetch(`/api/super-admin/costs?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch cost data");
      }
      return response.json();
    },
  });

  const costDataArray = Array.isArray(costData) ? costData : costData ? [costData] : [];

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "chat":
        return <MessageSquare className="w-4 h-4" />;
      case "website_analysis":
        return <Globe className="w-4 h-4" />;
      case "document_analysis":
        return <FileText className="w-4 h-4" />;
      case "image_search":
        return <Image className="w-4 h-4" />;
      case "voice_mode":
        return <Mic className="w-4 h-4" />;
      case "rag_embeddings":
        return <Sparkles className="w-4 h-4" />;
      default:
        return <BarChart3 className="w-4 h-4" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "chat":
        return "text-blue-600 bg-blue-50";
      case "website_analysis":
        return "text-green-600 bg-green-50";
      case "document_analysis":
        return "text-purple-600 bg-purple-50";
      case "image_search":
        return "text-orange-600 bg-orange-50";
      case "voice_mode":
        return "text-pink-600 bg-pink-50";
      case "rag_embeddings":
        return "text-cyan-600 bg-cyan-50";
      default:
        return "text-gray-600 bg-gray-50";
    }
  };

  const formatCategoryName = (category: string) => {
    return category
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const USD_TO_INR = 90;

  const parseCost = (cost: string): number => {
    return parseFloat(cost.replace(/[$₹]/g, ""));
  };

  const formatCost = (cost: number | string): string => {
    const usdCost = typeof cost === "string" ? parseCost(cost) : cost;
    const inrCost = usdCost * USD_TO_INR;
    return `₹${inrCost.toFixed(2)}`;
  };

  const aggregateCosts = () => {
    const totals = {
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      eventCount: 0,
      byCategory: new Map<string, { category: string; costUsd: number; tokensInput: number; tokensOutput: number; eventCount: number }>(),
    };

    costDataArray.forEach((business) => {
      totals.totalCost += parseCost(business.totalCost);
      totals.totalTokensInput += business.totalTokensInput;
      totals.totalTokensOutput += business.totalTokensOutput;
      totals.eventCount += business.eventCount;

      business.byCategory.forEach((cat) => {
        const existing = totals.byCategory.get(cat.category);
        const catCostUsd = parseCost(cat.cost);
        
        if (existing) {
          totals.byCategory.set(cat.category, {
            category: cat.category,
            costUsd: existing.costUsd + catCostUsd,
            tokensInput: existing.tokensInput + cat.tokensInput,
            tokensOutput: existing.tokensOutput + cat.tokensOutput,
            eventCount: existing.eventCount + cat.eventCount,
          });
        } else {
          totals.byCategory.set(cat.category, {
            category: cat.category,
            costUsd: catCostUsd,
            tokensInput: cat.tokensInput,
            tokensOutput: cat.tokensOutput,
            eventCount: cat.eventCount,
          });
        }
      });
    });

    return {
      totalCost: formatCost(totals.totalCost),
      totalTokensInput: totals.totalTokensInput,
      totalTokensOutput: totals.totalTokensOutput,
      eventCount: totals.eventCount,
      byCategory: Array.from(totals.byCategory.values()).map(cat => ({
        category: cat.category,
        cost: formatCost(cat.costUsd),
        tokensInput: cat.tokensInput,
        tokensOutput: cat.tokensOutput,
        eventCount: cat.eventCount,
      })),
    };
  };

  const aggregatedData = aggregateCosts();

  return (
    <div className="flex flex-col flex-1 h-screen">
      <header className="flex items-center justify-between h-[56px] px-6 bg-gradient-to-r from-red-500 via-purple-600 to-blue-600 shadow-sm">
        <div className="flex items-center gap-3">
          <SidebarTrigger data-testid="button-sidebar-toggle" className="text-white hover:bg-white/10 rounded-md" />
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-white leading-tight">AI Chroney</h1>
              <p className="text-[11px] text-white/90 leading-tight mt-0.5">Super Admin Cost Analytics</p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-gray-50">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
          <div className="mb-6">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-6 h-6 text-purple-600" />
                  <h2 className="text-2xl font-bold text-gray-900">Cost Analytics</h2>
                </div>
                <p className="text-muted-foreground mt-1">
                  AI usage costs and analytics for business accounts
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="w-full sm:w-64">
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Business Account
                  </label>
                  <Popover open={businessSearchOpen} onOpenChange={setBusinessSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={businessSearchOpen}
                        className="w-full justify-between font-normal"
                      >
                        {selectedBusinessId === "all"
                          ? "All Businesses"
                          : businessAccounts.find((account) => account.id === selectedBusinessId)?.name || "Select business..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search business account..." />
                        <CommandList>
                          <CommandEmpty>No business account found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="All Businesses"
                              onSelect={() => {
                                setSelectedBusinessId("all");
                                setBusinessSearchOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedBusinessId === "all" ? "opacity-100" : "opacity-0"
                                )}
                              />
                              All Businesses
                            </CommandItem>
                            {[...businessAccounts]
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map((account) => (
                                <CommandItem
                                  key={account.id}
                                  value={account.name}
                                  onSelect={() => {
                                    setSelectedBusinessId(account.id);
                                    setBusinessSearchOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedBusinessId === account.id ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  {account.name}
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="w-full sm:w-48">
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Date Range
                  </label>
                  <Select value={dateRangePreset} onValueChange={(value) => setDateRangePreset(value as DateRangePreset)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="yesterday">Yesterday</SelectItem>
                      <SelectItem value="last_week">Last Week</SelectItem>
                      <SelectItem value="this_month">This Month</SelectItem>
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {dateRangePreset === "custom" && (
                  <div className="flex gap-2">
                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                        From
                      </label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full sm:w-[140px] justify-start text-left font-normal",
                              !customDateFrom && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {customDateFrom ? format(customDateFrom, "MMM dd, yyyy") : "Pick date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={customDateFrom}
                            onSelect={setCustomDateFrom}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                        To
                      </label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full sm:w-[140px] justify-start text-left font-normal",
                              !customDateTo && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {customDateTo ? format(customDateTo, "MMM dd, yyyy") : "Pick date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={customDateTo}
                            onSelect={setCustomDateTo}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {isError && (
            <Card className="mb-6 border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-red-600" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-red-900 mb-1">Failed to Load Cost Data</h3>
                    <p className="text-sm text-red-700 mb-4">
                      {error instanceof Error ? error.message : "Unable to fetch cost analytics data"}
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

          {isLoading && (
            <div className="text-center py-16 mb-6">
              <div className="inline-block w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mb-4"></div>
              <p className="text-lg font-medium text-gray-900 mb-2">Loading Cost Analytics</p>
              <p className="text-sm text-gray-600">Gathering cost data from all business accounts...</p>
            </div>
          )}

          {!isLoading && !isError && (
            <>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Total Cost Summary</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4 text-purple-600" />
                          <span>Total Cost</span>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-purple-900">{aggregatedData.totalCost}</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-blue-600" />
                          <span>Events</span>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-blue-900">{aggregatedData.eventCount.toLocaleString()}</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-green-600" />
                          <span>Input Tokens</span>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-green-900">{aggregatedData.totalTokensInput.toLocaleString()}</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-gray-600">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-orange-600" />
                          <span>Output Tokens</span>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-orange-900">{aggregatedData.totalTokensOutput.toLocaleString()}</div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Cost by Category</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                  {aggregatedData.byCategory.map((category) => (
                    <Card key={category.category} className={cn("border-l-4", getCategoryColor(category.category).replace("bg-", "border-l-").replace("-50", "-400"))}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-gray-600">
                          <div className="flex items-center gap-2">
                            <div className={cn("p-1.5 rounded", getCategoryColor(category.category))}>
                              {getCategoryIcon(category.category)}
                            </div>
                            <span>{formatCategoryName(category.category)}</span>
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-xl font-bold text-gray-900 mb-2">{category.cost}</div>
                        <div className="text-xs text-gray-600 space-y-1">
                          <div className="flex justify-between">
                            <span>Events:</span>
                            <span className="font-medium">{category.eventCount.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>In Tokens:</span>
                            <span className="font-medium">{category.tokensInput.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Out Tokens:</span>
                            <span className="font-medium">{category.tokensOutput.toLocaleString()}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              {costDataArray.length > 0 && selectedBusinessId === "all" && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Cost per Business</h3>
                  <Card>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="font-semibold">Business</TableHead>
                              <TableHead className="font-semibold text-right">Total Cost</TableHead>
                              <TableHead className="font-semibold text-right">Events</TableHead>
                              <TableHead className="font-semibold text-right">Input Tokens</TableHead>
                              <TableHead className="font-semibold text-right">Output Tokens</TableHead>
                              <TableHead className="font-semibold">Top Categories</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[...costDataArray]
                              .sort((a, b) => parseCost(b.totalCost) - parseCost(a.totalCost))
                              .map((business) => {
                                const businessAccount = businessAccounts.find((acc) => acc.id === business.businessAccountId);
                                const topCategories = [...business.byCategory]
                                  .sort((a, b) => parseCost(b.cost) - parseCost(a.cost))
                                  .slice(0, 3);

                                return (
                                  <TableRow key={business.businessAccountId}>
                                    <TableCell className="font-medium">
                                      {business.businessName || businessAccount?.name || "Unknown"}
                                    </TableCell>
                                    <TableCell className="text-right font-semibold text-purple-900">
                                      {formatCost(business.totalCost)}
                                    </TableCell>
                                    <TableCell className="text-right">{business.eventCount.toLocaleString()}</TableCell>
                                    <TableCell className="text-right">{business.totalTokensInput.toLocaleString()}</TableCell>
                                    <TableCell className="text-right">{business.totalTokensOutput.toLocaleString()}</TableCell>
                                    <TableCell>
                                      <div className="flex gap-1.5 flex-wrap">
                                        {topCategories.map((cat) => (
                                          <Badge
                                            key={cat.category}
                                            variant="secondary"
                                            className={cn("text-xs", getCategoryColor(cat.category))}
                                          >
                                            {formatCategoryName(cat.category)}: {formatCost(cat.cost)}
                                          </Badge>
                                        ))}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {costDataArray.length === 0 && (
                <Card>
                  <CardContent className="text-center py-12">
                    <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-600">No cost data found for the selected period</p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
