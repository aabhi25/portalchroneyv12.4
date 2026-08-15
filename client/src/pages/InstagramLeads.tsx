import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import InstagramTabBar from "@/components/InstagramTabBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  DialogFooter,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Clock,
  Trash2,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Inbox,
  ArrowLeft,
  Instagram,
  Users,
} from "lucide-react";

interface InstagramLead {
  id: string;
  senderId: string;
  senderUsername: string | null;
  flowSessionId: string | null;
  extractedData: Record<string, any> | null;
  status: string;
  receivedAt: string;
  createdAt: string;
}

interface LeadField {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: string;
  isRequired: boolean;
  isDefault: boolean;
  isEnabled: boolean;
  displayOrder: number;
}

const parseUTCDate = (d: string) => new Date(d.endsWith('Z') ? d : d + 'Z');

export default function InstagramLeads() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const currentPage = location.includes("instagram-lead-capture-settings")
    ? "lead-capture-settings"
    : "leads";

  const [leadsPage, setLeadsPage] = useState(1);
  const [leadToDelete, setLeadToDelete] = useState<InstagramLead | null>(null);
  const [leadCaptureEnabled, setLeadCaptureEnabled] = useState(false);
  const [showAddFieldDialog, setShowAddFieldDialog] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const leadsPerPage = 10;

  const { data: settingsData } = useQuery({
    queryKey: ["/api/instagram/settings"],
    queryFn: async () => {
      const res = await fetch("/api/instagram/settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  useEffect(() => {
    if (settingsData?.leadCaptureEnabled !== undefined) {
      setLeadCaptureEnabled(settingsData.leadCaptureEnabled === "true" || settingsData.leadCaptureEnabled === true);
    }
  }, [settingsData]);

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ["/api/instagram/leads", leadsPage],
    queryFn: async () => {
      const offset = (leadsPage - 1) * leadsPerPage;
      const res = await fetch(`/api/instagram/leads?limit=${leadsPerPage}&offset=${offset}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json() as Promise<{ leads: InstagramLead[]; total: number }>;
    },
  });

  const { data: leadFieldsData, isLoading: leadFieldsLoading } = useQuery({
    queryKey: ["/api/instagram/lead-fields"],
    queryFn: async () => {
      const res = await fetch("/api/instagram/lead-fields", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch lead fields");
      return res.json() as Promise<{ fields: LeadField[] }>;
    },
  });

  const displayedLeadFields = useMemo(() => {
    return (leadFieldsData?.fields || [])
      .filter((f: LeadField) => f.isEnabled)
      .sort((a: LeadField, b: LeadField) => a.displayOrder - b.displayOrder)
;
  }, [leadFieldsData]);

  const deleteLeadMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const res = await fetch(`/api/instagram/leads/${leadId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instagram/leads"] });
      toast({ title: "Lead deleted successfully" });
      setLeadToDelete(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete lead", description: error.message, variant: "destructive" });
    },
  });

  const updateCaptureSettingsMutation = useMutation({
    mutationFn: async (data: { leadCaptureEnabled: boolean }) => {
      const res = await fetch("/api/instagram/lead-capture-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instagram/settings"] });
      toast({ title: "Settings updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createFieldMutation = useMutation({
    mutationFn: async (data: { fieldKey: string; fieldLabel: string; fieldType: string }) => {
      const res = await fetch("/api/instagram/lead-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create field");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instagram/lead-fields"] });
      setShowAddFieldDialog(false);
      setNewFieldLabel("");
      setNewFieldType("text");
      toast({ title: "Field added", description: "New lead field has been created." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateFieldMutation = useMutation({
    mutationFn: async ({ fieldId, isEnabled }: { fieldId: string; isEnabled: boolean }) => {
      const res = await fetch(`/api/instagram/lead-fields/${fieldId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isEnabled }),
      });
      if (!res.ok) throw new Error("Failed to update field");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instagram/lead-fields"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteFieldMutation = useMutation({
    mutationFn: async (fieldId: string) => {
      const res = await fetch(`/api/instagram/lead-fields/${fieldId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete field");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/instagram/lead-fields"] });
      toast({ title: "Field deleted", description: "Lead field has been removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <InstagramTabBar activeTab="leads" />

      <div className="p-6">
        {currentPage === "leads" && (
          <Card className="shadow-lg border-0 rounded-xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-4 bg-gradient-to-r from-pink-50 via-purple-50 to-indigo-50 border-b">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-xl font-semibold tracking-tight">Instagram Leads</CardTitle>
                  {leadsData?.total !== undefined && (
                    <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-pink-100 text-pink-700 border-0">
                      {leadsData.total} {leadsData.total === 1 ? 'lead' : 'leads'}
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-sm text-muted-foreground">
                  Leads captured from Instagram DMs with AI-extracted information
                </CardDescription>
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="rounded-full h-9 w-9 border-slate-200 hover:bg-slate-100 transition-colors"
                      onClick={() => setLocation("/admin/instagram-lead-capture-settings")}
                    >
                      <Settings className="h-4 w-4 text-slate-500" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Lead Capture Settings</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardHeader>
            <CardContent className="p-0">
              {leadsLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-pink-500 mb-3" />
                  <p className="text-sm text-muted-foreground">Loading leads...</p>
                </div>
              ) : !leadsData?.leads.length ? (
                <div className="flex flex-col items-center justify-center py-20 px-4">
                  <div className="rounded-full bg-slate-100 p-5 mb-5">
                    <Inbox className="h-10 w-10 text-slate-400" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-700 mb-1">No leads yet</h3>
                  <p className="text-sm text-muted-foreground text-center max-w-sm">
                    When users interact with your Instagram flows, their information will be captured and displayed here.
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/80 hover:bg-slate-50/80 border-b">
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 pl-6">Received</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3">Sender</TableHead>
                          {displayedLeadFields.map((field: LeadField) => (
                            <TableHead key={field.id} className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3">
                              {field.fieldLabel} <span className="text-[10px] font-normal normal-case tracking-normal text-slate-400">(AI Extracted)</span>
                            </TableHead>
                          ))}
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 pr-6 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leadsData.leads.map((lead) => (
                          <TableRow
                            key={lead.id}
                            className="group hover:bg-slate-50/60 transition-colors border-b last:border-0"
                          >
                            <TableCell className="py-4 pl-6">
                              <div className="flex items-center gap-2">
                                <Clock className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                                <div>
                                  <div className="text-sm font-medium text-slate-700">
                                    {format(parseUTCDate(lead.receivedAt), "h:mm a")}
                                  </div>
                                  <div className="text-xs text-slate-400 mt-0.5">
                                    {format(parseUTCDate(lead.receivedAt), "MMM d, yyyy")}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-4">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800 truncate">
                                  <Instagram className="h-3.5 w-3.5 text-pink-500 flex-shrink-0" />
                                  <span>{lead.senderUsername ? `@${lead.senderUsername}` : lead.senderId}</span>
                                </div>
                              </div>
                            </TableCell>
                            {displayedLeadFields.map((field: LeadField) => {
                              const value = lead.extractedData?.[field.fieldKey];
                              return (
                                <TableCell key={field.id} className="py-4">
                                  <div className="text-sm text-slate-700 truncate max-w-[200px]">
                                    {value || <span className="text-slate-400 italic">—</span>}
                                  </div>
                                </TableCell>
                              );
                            })}
                            <TableCell className="py-4 pr-6">
                              <div className="flex items-center justify-end gap-1">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 rounded-full hover:bg-red-50"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setLeadToDelete(lead);
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4 text-red-400" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p>Delete Lead</p></TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {leadsData.total > leadsPerPage && (
                    <div className="flex items-center justify-between px-6 py-4 border-t bg-slate-50/50">
                      <p className="text-sm text-slate-500">
                        Showing <span className="font-medium text-slate-700">{((leadsPage - 1) * leadsPerPage) + 1}</span> to <span className="font-medium text-slate-700">{Math.min(leadsPage * leadsPerPage, leadsData.total)}</span> of <span className="font-medium text-slate-700">{leadsData.total}</span> leads
                      </p>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-3 rounded-lg text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 disabled:opacity-40"
                          onClick={() => setLeadsPage(p => Math.max(1, p - 1))}
                          disabled={leadsPage === 1}
                        >
                          <ChevronLeft className="h-4 w-4 mr-1" />
                          Previous
                        </Button>
                        <div className="flex items-center gap-0.5 mx-2">
                          {Array.from({ length: Math.min(Math.ceil(leadsData.total / leadsPerPage), 5) }, (_, i) => {
                            const totalPages = Math.ceil(leadsData.total / leadsPerPage);
                            let pageNum: number;
                            if (totalPages <= 5) {
                              pageNum = i + 1;
                            } else if (leadsPage <= 3) {
                              pageNum = i + 1;
                            } else if (leadsPage >= totalPages - 2) {
                              pageNum = totalPages - 4 + i;
                            } else {
                              pageNum = leadsPage - 2 + i;
                            }
                            return (
                              <Button
                                key={pageNum}
                                variant={pageNum === leadsPage ? "default" : "ghost"}
                                size="sm"
                                className={`h-8 w-8 p-0 rounded-lg text-sm ${
                                  pageNum === leadsPage
                                    ? "bg-slate-800 text-white hover:bg-slate-700 shadow-sm"
                                    : "text-slate-600 hover:bg-slate-200/60"
                                }`}
                                onClick={() => setLeadsPage(pageNum)}
                              >
                                {pageNum}
                              </Button>
                            );
                          })}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-3 rounded-lg text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 disabled:opacity-40"
                          onClick={() => setLeadsPage(p => p + 1)}
                          disabled={leadsPage >= Math.ceil(leadsData.total / leadsPerPage)}
                        >
                          Next
                          <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {currentPage === "lead-capture-settings" && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setLocation("/admin/instagram-leads")}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <CardTitle>IG Lead Capture Settings</CardTitle>
                  <CardDescription>
                    Configure which fields to extract from incoming Instagram messages. Enable or disable fields, and add custom fields for your business needs.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">Enable Lead Capture</Label>
                  <p className="text-sm text-gray-500">
                    Automatically create leads from extracted Instagram message data
                  </p>
                </div>
                <Switch
                  checked={leadCaptureEnabled}
                  onCheckedChange={(checked) => {
                    setLeadCaptureEnabled(checked);
                    updateCaptureSettingsMutation.mutate({ leadCaptureEnabled: checked });
                  }}
                />
              </div>

              {leadCaptureEnabled && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium">Lead Fields</h3>
                    <Button
                      size="sm"
                      onClick={() => setShowAddFieldDialog(true)}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Custom Field
                    </Button>
                  </div>

                  {leadFieldsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {leadFieldsData?.fields.map((field) => (
                        <div key={field.id} className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex items-center gap-4">
                            <Switch
                              checked={field.isEnabled}
                              onCheckedChange={(checked) => {
                                updateFieldMutation.mutate({ fieldId: field.id, isEnabled: checked });
                              }}
                            />
                            <div className="space-y-0.5">
                              <Label className="text-base">{field.fieldLabel}</Label>
                              <p className="text-xs text-gray-500">
                                Type: {field.fieldType} {field.isDefault && "(default field)"}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {!field.isDefault && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => deleteFieldMutation.mutate(field.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog open={showAddFieldDialog} onOpenChange={setShowAddFieldDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Custom Field</DialogTitle>
              <DialogDescription>
                Create a new field to extract from Instagram messages. The AI will attempt to find this information in incoming messages.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Field Label</Label>
                <Input
                  placeholder="e.g., Course Name, Product Interest, Budget"
                  value={newFieldLabel}
                  onChange={(e) => setNewFieldLabel(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Field Type</Label>
                <Select value={newFieldType} onValueChange={setNewFieldType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone">Phone</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddFieldDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (newFieldLabel.trim()) {
                    createFieldMutation.mutate({
                      fieldKey: newFieldLabel.toLowerCase().replace(/\s+/g, "_"),
                      fieldLabel: newFieldLabel.trim(),
                      fieldType: newFieldType,
                    });
                  }
                }}
                disabled={!newFieldLabel.trim() || createFieldMutation.isPending}
              >
                {createFieldMutation.isPending ? "Adding..." : "Add Field"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <AlertDialog open={!!leadToDelete} onOpenChange={() => setLeadToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this lead. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => leadToDelete && deleteLeadMutation.mutate(leadToDelete.id)}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
