import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  MapPin, 
  ChevronDown, 
  ChevronUp, 
  Monitor, 
  Smartphone, 
  Tablet, 
  Clock, 
  Globe, 
  MessageSquare, 
  Eye, 
  Search,
  ArrowLeft,
  FileText,
  Layers,
  BarChart3,
  User,
  Tag,
  Mail,
  Phone
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

interface VisitorJourney {
  visitorToken: string;
  deviceType: string | null;
  browser: string | null;
  country: string | null;
  city: string | null;
  openedChat: boolean;
  firstVisitAt: string;
  lastVisitAt: string;
  visitCount: number;
  totalPagesViewed: number;
  totalTimeSpentSeconds: number;
  hasLead: boolean;
  topicsOfInterest: string[];
}

interface PageView {
  id: string;
  pageUrl: string;
  pageTitle: string | null;
  pagePath: string | null;
  timeSpentSeconds: string | null;
  scrollDepthPercent: string | null;
  createdAt: string;
  sections: SectionView[];
}

interface SectionView {
  id: string;
  sectionId: string | null;
  sectionName: string | null;
  sectionType: string | null;
  timeSpentSeconds: string | null;
}

interface VisitorDetails {
  visitor: {
    visitorToken: string;
    deviceType: string | null;
    browser: string | null;
    country: string | null;
    city: string | null;
    openedChat: string;
    firstVisitAt: string;
    lastVisitAt: string;
    visitCount: string;
  } | null;
  pageViews: PageView[];
  topSections: { sectionName: string; totalTimeSeconds: number; viewCount: number }[];
  topPages: { pagePath: string; totalTimeSeconds: number; viewCount: number }[];
  lead: { id: string; name: string | null; email: string | null; phone: string | null; topicsOfInterest: string[] | null } | null;
  topicsOfInterest: string[];
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function getDeviceIcon(deviceType: string | null) {
  switch (deviceType) {
    case 'mobile': return <Smartphone className="w-4 h-4" />;
    case 'tablet': return <Tablet className="w-4 h-4" />;
    default: return <Monitor className="w-4 h-4" />;
  }
}

export default function VisitorJourneys() {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedVisitor, setExpandedVisitor] = useState<string | null>(null);
  
  const { data: journeysData, isLoading } = useQuery<{ visitors: VisitorJourney[]; total: number }>({
    queryKey: ["/api/analytics/visitor-journeys", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      const response = await fetch(`/api/analytics/visitor-journeys?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch visitor journeys");
      return response.json();
    },
  });
  
  const { data: visitorDetails, isLoading: isLoadingDetails } = useQuery<VisitorDetails>({
    queryKey: ["/api/analytics/visitor-journeys", expandedVisitor],
    queryFn: async () => {
      if (!expandedVisitor) return { visitor: null, pageViews: [], topSections: [], topPages: [], lead: null, topicsOfInterest: [] };
      const response = await fetch(`/api/analytics/visitor-journeys/${encodeURIComponent(expandedVisitor)}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch visitor details");
      return response.json();
    },
    enabled: !!expandedVisitor,
  });
  
  const visitors = journeysData?.visitors || [];
  
  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/insights">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Insights
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MapPin className="w-6 h-6 text-indigo-600" />
              Visitor Journeys
            </h1>
            <p className="text-sm text-gray-500">
              See what pages and sections your visitors are exploring
            </p>
          </div>
        </div>
        <Badge variant="outline" className="text-lg px-3 py-1">
          {journeysData?.total || 0} Visitors
        </Badge>
      </div>
      
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by city, country, or browser..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>
      
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500">Loading visitor journeys...</p>
        </div>
      ) : visitors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">No visitor journeys yet</h3>
            <p className="text-sm text-gray-500">
              Visitor journeys will appear here once visitors interact with your embedded chat widget.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visitors.map((visitor) => {
            const isExpanded = expandedVisitor === visitor.visitorToken;
            
            return (
              <Collapsible
                key={visitor.visitorToken}
                open={isExpanded}
                onOpenChange={(open) => setExpandedVisitor(open ? visitor.visitorToken : null)}
              >
                <Card className={isExpanded ? "ring-2 ring-indigo-200" : ""}>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-2 bg-gray-100 rounded-full">
                            {getDeviceIcon(visitor.deviceType)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">
                                {visitor.city || "Unknown"}{visitor.country ? `, ${visitor.country}` : ""}
                              </span>
                              {visitor.hasLead && (
                                <Badge className="text-xs bg-green-100 text-green-700 hover:bg-green-100">
                                  <User className="w-3 h-3 mr-1" />
                                  Lead
                                </Badge>
                              )}
                              {visitor.openedChat && (
                                <Badge variant="secondary" className="text-xs">
                                  <MessageSquare className="w-3 h-3 mr-1" />
                                  Chatted
                                </Badge>
                              )}
                            </div>
                            {visitor.topicsOfInterest && visitor.topicsOfInterest.length > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                                <Tag className="w-3 h-3 text-gray-400" />
                                {visitor.topicsOfInterest.slice(0, 4).map((topic, idx) => (
                                  <Badge 
                                    key={idx} 
                                    variant="outline" 
                                    className="text-xs px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200"
                                  >
                                    {topic}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                              <span className="flex items-center gap-1">
                                <Globe className="w-3 h-3" />
                                {visitor.browser || "Unknown"}
                              </span>
                              <span className="flex items-center gap-1">
                                <Eye className="w-3 h-3" />
                                {visitor.totalPagesViewed} pages
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDuration(visitor.totalTimeSpentSeconds)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right text-xs text-gray-500">
                            <div>First: {format(new Date(visitor.firstVisitAt), "MMM d, h:mm a")}</div>
                            <div>Last: {format(new Date(visitor.lastVisitAt), "MMM d, h:mm a")}</div>
                          </div>
                          {isExpanded ? (
                            <ChevronUp className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent>
                    <CardContent className="border-t pt-4">
                      {isLoadingDetails ? (
                        <div className="text-center py-6">
                          <div className="animate-spin w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full mx-auto" />
                        </div>
                      ) : visitorDetails ? (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                          <div className="lg:col-span-2">
                            <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4 text-indigo-600" />
                              Pages Visited
                            </h4>
                            <div className="space-y-2">
                              {visitorDetails.pageViews.length === 0 ? (
                                <p className="text-sm text-gray-500">No page views tracked yet</p>
                              ) : (
                                visitorDetails.pageViews.map((pv) => (
                                  <div key={pv.id} className="p-3 bg-gray-50 rounded-lg">
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1 min-w-0">
                                        <p className="font-medium text-sm truncate">
                                          {pv.pageTitle || pv.pagePath || pv.pageUrl}
                                        </p>
                                        <p className="text-xs text-gray-500 truncate">{pv.pagePath || pv.pageUrl}</p>
                                      </div>
                                      <div className="flex items-center gap-3 text-xs text-gray-500 ml-4">
                                        <span className="flex items-center gap-1">
                                          <Clock className="w-3 h-3" />
                                          {formatDuration(Number(pv.timeSpentSeconds || 0))}
                                        </span>
                                        <span>{Number(pv.scrollDepthPercent || 0).toFixed(0)}% scroll</span>
                                      </div>
                                    </div>
                                    {pv.sections.length > 0 && (
                                      <div className="mt-2 pt-2 border-t border-gray-200">
                                        <p className="text-xs font-medium text-gray-600 mb-1">Sections viewed:</p>
                                        <div className="flex flex-wrap gap-1">
                                          {pv.sections.map((s) => (
                                            <Badge key={s.id} variant="outline" className="text-xs">
                                              {s.sectionName || s.sectionId} ({formatDuration(Number(s.timeSpentSeconds || 0))})
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                          
                          <div className="space-y-4">
                            {visitorDetails.lead && (
                              <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                                <h4 className="font-medium text-sm mb-2 flex items-center gap-2 text-green-800">
                                  <User className="w-4 h-4" />
                                  Lead Information
                                </h4>
                                <div className="space-y-1.5 text-sm">
                                  {visitorDetails.lead.name && (
                                    <p className="text-gray-700">{visitorDetails.lead.name}</p>
                                  )}
                                  {visitorDetails.lead.email && (
                                    <p className="text-gray-600 flex items-center gap-1.5">
                                      <Mail className="w-3 h-3" />
                                      {visitorDetails.lead.email}
                                    </p>
                                  )}
                                  {visitorDetails.lead.phone && (
                                    <p className="text-gray-600 flex items-center gap-1.5">
                                      <Phone className="w-3 h-3" />
                                      {visitorDetails.lead.phone}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                            
                            {visitorDetails.topicsOfInterest && visitorDetails.topicsOfInterest.length > 0 && (
                              <div>
                                <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                                  <Tag className="w-4 h-4 text-blue-600" />
                                  Topics of Interest
                                </h4>
                                <div className="flex flex-wrap gap-1.5">
                                  {visitorDetails.topicsOfInterest.map((topic, idx) => (
                                    <Badge 
                                      key={idx} 
                                      variant="outline" 
                                      className="text-xs bg-blue-50 text-blue-700 border-blue-200"
                                    >
                                      {topic}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            <div>
                              <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                                <Layers className="w-4 h-4 text-purple-600" />
                                Top Sections
                              </h4>
                              {visitorDetails.topSections.length === 0 ? (
                                <p className="text-xs text-gray-500">No section data</p>
                              ) : (
                                <div className="space-y-2">
                                  {visitorDetails.topSections.slice(0, 5).map((s, idx) => (
                                    <div key={idx} className="flex items-center justify-between text-sm">
                                      <span className="text-gray-700 truncate flex-1">{s.sectionName}</span>
                                      <Badge variant="secondary" className="ml-2 text-xs">
                                        {formatDuration(s.totalTimeSeconds)}
                                      </Badge>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            
                            <div>
                              <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                                <BarChart3 className="w-4 h-4 text-green-600" />
                                Top Pages
                              </h4>
                              {visitorDetails.topPages.length === 0 ? (
                                <p className="text-xs text-gray-500">No page data</p>
                              ) : (
                                <div className="space-y-2">
                                  {visitorDetails.topPages.slice(0, 5).map((p, idx) => (
                                    <div key={idx} className="flex items-center justify-between text-sm">
                                      <span className="text-gray-700 truncate flex-1">{p.pagePath}</span>
                                      <Badge variant="secondary" className="ml-2 text-xs">
                                        {formatDuration(p.totalTimeSeconds)}
                                      </Badge>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}
