import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, 
  TrendingUp, 
  Search, 
  Target, 
  BarChart3,
  PieChart,
  Clock,
  AlertTriangle,
  CheckCircle,
  Package,
  Eye,
  ArrowLeft
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  PieChart as RechartsPieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from "recharts";
import { Link } from "wouter";
import { motion } from "framer-motion";

interface InsightsSummary {
  totalSearches: number;
  searchesWithMatches: number;
  searchesWithExactMatch: number;
  demandGapsCount: number;
  successRate: number;
  exactMatchRate: number;
  avgMatchesPerSearch: number;
}

interface CategoryData {
  name: string;
  value: number;
}

interface TopProduct {
  id: string;
  name: string;
  imageUrl: string | null;
  matchCount: number;
  category: string | null;
}

interface HourlyData {
  hour: string;
  searches: number;
}

interface DailyData {
  date: string;
  searches: number;
}

interface DemandGap {
  id: string;
  imageUrl: string;
  searchedAt: string;
  source: string;
}

interface VistaInsightsData {
  summary: InsightsSummary;
  categoryDistribution: CategoryData[];
  topMatchedProducts: TopProduct[];
  hourlyDistribution: HourlyData[];
  dailyTrend: DailyData[];
  demandGaps: DemandGap[];
}

const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6'];

export default function VistaInsights() {
  const { data, isLoading, error } = useQuery<VistaInsightsData>({
    queryKey: ["/api/vista/insights"],
    queryFn: async () => {
      const response = await fetch("/api/vista/insights", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch insights");
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-destructive" />
          <p className="text-lg text-muted-foreground">Failed to load insights</p>
        </div>
      </div>
    );
  }

  const summary = data?.summary || {
    totalSearches: 0,
    searchesWithMatches: 0,
    searchesWithExactMatch: 0,
    demandGapsCount: 0,
    successRate: 0,
    exactMatchRate: 0,
    avgMatchesPerSearch: 0,
  };

  const categoryDistribution = data?.categoryDistribution || [];
  const topMatchedProducts = data?.topMatchedProducts || [];
  const hourlyDistribution = data?.hourlyDistribution || [];
  const dailyTrend = data?.dailyTrend || [];
  const demandGaps = data?.demandGaps || [];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/jewelry-showcase">
              <Button variant="ghost" size="icon" className="mr-2">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Vista Insights</h1>
              <p className="text-muted-foreground">
                Visual search analytics and customer behavior
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Searches</CardTitle>
              <Search className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalSearches}</div>
              <p className="text-xs text-muted-foreground">
                Visual product searches
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.successRate}%</div>
              <p className="text-xs text-muted-foreground">
                Searches with matches
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Perfect Matches</CardTitle>
              <Target className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.exactMatchRate}%</div>
              <p className="text-xs text-muted-foreground">
                Exact product matches
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Demand Gaps</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.demandGapsCount}</div>
              <p className="text-xs text-muted-foreground">
                Searches with no matches
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2 mb-8">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChart className="w-5 h-5 text-purple-500" />
                Category Distribution
              </CardTitle>
              <CardDescription>
                Most searched jewelry categories
              </CardDescription>
            </CardHeader>
            <CardContent>
              {categoryDistribution.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <PieChart className="w-12 h-12 mb-3 opacity-50" />
                  <p>No category data yet</p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="relative"
                  >
                    <svg width="240" height="240" viewBox="0 0 240 240" className="drop-shadow-lg">
                      <defs>
                        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                          <feMerge>
                            <feMergeNode in="coloredBlur"/>
                            <feMergeNode in="SourceGraphic"/>
                          </feMerge>
                        </filter>
                        {COLORS.map((color, i) => (
                          <linearGradient key={`grad-${i}`} id={`gradient-${i}`} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={color} stopOpacity="1"/>
                            <stop offset="100%" stopColor={color} stopOpacity="0.8"/>
                          </linearGradient>
                        ))}
                      </defs>
                      <g transform="translate(120, 120)">
                        {(() => {
                          const total = categoryDistribution.reduce((sum, item) => sum + item.value, 0);
                          let currentAngle = -90;
                          return categoryDistribution.map((item, index) => {
                            const percentage = item.value / total;
                            const angle = percentage * 360;
                            const startAngle = currentAngle;
                            const endAngle = currentAngle + angle;
                            currentAngle = endAngle;
                            
                            const startRad = (startAngle * Math.PI) / 180;
                            const endRad = (endAngle * Math.PI) / 180;
                            const radius = 95;
                            const innerRadius = 55;
                            
                            const x1 = Math.cos(startRad) * radius;
                            const y1 = Math.sin(startRad) * radius;
                            const x2 = Math.cos(endRad) * radius;
                            const y2 = Math.sin(endRad) * radius;
                            const x3 = Math.cos(endRad) * innerRadius;
                            const y3 = Math.sin(endRad) * innerRadius;
                            const x4 = Math.cos(startRad) * innerRadius;
                            const y4 = Math.sin(startRad) * innerRadius;
                            
                            const largeArc = angle > 180 ? 1 : 0;
                            
                            const path = `
                              M ${x1} ${y1}
                              A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}
                              L ${x3} ${y3}
                              A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4}
                              Z
                            `;
                            
                            return (
                              <motion.path
                                key={index}
                                d={path}
                                fill={`url(#gradient-${index % COLORS.length})`}
                                stroke="white"
                                strokeWidth="2"
                                initial={{ pathLength: 0, opacity: 0 }}
                                animate={{ pathLength: 1, opacity: 1 }}
                                transition={{ 
                                  duration: 0.8, 
                                  delay: index * 0.1,
                                  ease: "easeOut"
                                }}
                                whileHover={{ 
                                  scale: 1.03,
                                  filter: "brightness(1.1)",
                                  transition: { duration: 0.2 }
                                }}
                                className="cursor-pointer origin-center"
                                style={{ transformOrigin: "center" }}
                              />
                            );
                          });
                        })()}
                        <circle cx="0" cy="0" r="50" fill="white" className="dark:fill-gray-900" />
                        <motion.text
                          x="0"
                          y="-5"
                          textAnchor="middle"
                          className="fill-gray-700 dark:fill-gray-200 text-2xl font-bold"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.8 }}
                        >
                          {categoryDistribution.reduce((sum, item) => sum + item.value, 0)}
                        </motion.text>
                        <motion.text
                          x="0"
                          y="15"
                          textAnchor="middle"
                          className="fill-gray-500 dark:fill-gray-400 text-xs"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.9 }}
                        >
                          Searches
                        </motion.text>
                      </g>
                    </svg>
                  </motion.div>
                  
                  <motion.div 
                    className="grid grid-cols-2 gap-x-8 gap-y-3 mt-4 w-full max-w-sm"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.6 }}
                  >
                    {categoryDistribution.map((item, index) => {
                      const total = categoryDistribution.reduce((sum, i) => sum + i.value, 0);
                      const percentage = ((item.value / total) * 100).toFixed(0);
                      return (
                        <motion.div 
                          key={index}
                          className="flex items-center gap-2 group cursor-pointer"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3, delay: 0.7 + index * 0.05 }}
                          whileHover={{ x: 3 }}
                        >
                          <motion.div 
                            className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                            whileHover={{ scale: 1.2 }}
                          />
                          <span className="text-sm capitalize group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors" title={item.name}>
                            {item.name}
                          </span>
                          <span className="text-sm font-semibold text-muted-foreground ml-auto">
                            {percentage}%
                          </span>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-500" />
                Peak Search Hours
              </CardTitle>
              <CardDescription>
                When customers are most active
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hourlyDistribution.every(h => h.searches === 0) ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <BarChart3 className="w-12 h-12 mb-3 opacity-50" />
                  <p>No hourly data yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={hourlyDistribution}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="searches" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-500" />
              Search Trend (Last 30 Days)
            </CardTitle>
            <CardDescription>
              Daily visual search activity
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dailyTrend.every(d => d.searches === 0) ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <TrendingUp className="w-12 h-12 mb-3 opacity-50" />
                <p>No trend data yet</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 10 }} 
                    tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    interval={4}
                  />
                  <YAxis />
                  <Tooltip 
                    labelFormatter={(value) => new Date(value).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="searches" 
                    stroke="#8b5cf6" 
                    strokeWidth={2}
                    dot={{ fill: '#8b5cf6', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5 text-indigo-500" />
                Top Matched Products
              </CardTitle>
              <CardDescription>
                Products that appear most frequently in search results
              </CardDescription>
            </CardHeader>
            <CardContent>
              {topMatchedProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <Package className="w-12 h-12 mb-3 opacity-50" />
                  <p>No matched products yet</p>
                </div>
              ) : (
                <div className="max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Matches</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topMatchedProducts.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              {product.imageUrl && (
                                <img 
                                  src={product.imageUrl} 
                                  alt={product.name}
                                  className="w-10 h-10 rounded object-cover"
                                />
                              )}
                              <span className="font-medium truncate max-w-[150px]">{product.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {product.category ? (
                              <Badge variant="secondary" className="capitalize">
                                {product.category}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {product.matchCount}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Demand Gaps (Missing Inventory)
              </CardTitle>
              <CardDescription>
                Searches where no matching products were found
              </CardDescription>
            </CardHeader>
            <CardContent>
              {demandGaps.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[200px] text-muted-foreground">
                  <CheckCircle className="w-12 h-12 mb-3 opacity-50 text-green-500" />
                  <p>Great! No demand gaps found</p>
                </div>
              ) : (
                <div className="max-h-[500px] overflow-y-auto pr-2 space-y-3">
                  {demandGaps.map((gap) => (
                    <div 
                      key={gap.id} 
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <img 
                        src={gap.imageUrl} 
                        alt="Search image"
                        className="w-14 h-14 rounded-lg object-cover border shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">No matches found</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(gap.searchedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                        <Badge variant="outline" className="mt-1 text-xs">
                          {gap.source}
                        </Badge>
                      </div>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={gap.imageUrl} target="_blank" rel="noopener noreferrer">
                          <Eye className="w-4 h-4" />
                        </a>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
