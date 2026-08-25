import { useState, useEffect, useRef, useMemo } from "react";
import { formatCrmSyncError } from "@/lib/crmSyncError";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
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
import { MessageCircle, Settings, Users, Copy, Check, Phone, Mail, User, FileText, Image, Download, Upload, ExternalLink, MessagesSquare, ArrowLeft, Loader2, CheckCircle, XCircle, Plus, Trash2, GitBranch, Play, Pause, Edit, Info, GripVertical, RefreshCw, ChevronDown, ChevronLeft, ChevronRight, Sparkles, Clock, Inbox, BarChart3, Route, ShieldCheck, AlertTriangle, X, CalendarIcon, LayoutList, Sheet, Link2, Search, Zap, Pencil, FlaskConical, Megaphone, FileCode2, UsersRound } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, formatDistanceToNow } from "date-fns";
import * as XLSX from "xlsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Helper to parse UTC timestamps correctly
// PostgreSQL returns timestamps without timezone info, so we need to ensure they're interpreted as UTC
const parseUTCDate = (dateString: string | Date): Date => {
  if (dateString instanceof Date) return dateString;
  // If the string doesn't end with Z, append it to indicate UTC
  const utcString = dateString.endsWith('Z') ? dateString : dateString + 'Z';
  return new Date(utcString);
};
import { SidebarTrigger } from "@/components/ui/sidebar";
import WhatsAppHub from "@/components/whatsapp/WhatsAppHub";
import type { MeResponseDto } from "@shared/dto";

interface WhatsappSettings {
  whatsappEnabled: string;
  /** Presence only — the server never sends the actual auth key to the browser. */
  msg91AuthKeyConfigured: boolean;
  whatsappNumber: string | null;
  extractionFields: string[];
  customPrompt: string | null;
  autoSyncToLeadsquared: boolean;
  /** Presence only — fetch the full webhook URL on demand when the user asks to copy it. */
  webhookSecretConfigured: boolean;
  leadCaptureEnabled: boolean;
  leadGenerationMode: string;
  requireName: boolean;
  requirePhone: boolean;
  requireEmail: boolean;
  minFieldsRequired: number;
  autoReplyEnabled: boolean;
  msg91IntegratedNumberId: string;
  newApplicationCooldownDays: number;
  phoneNumberLength: number;
  updateLeadEnabled: boolean;
  useMasterTraining: string;
  useLeadTraining: string;
  sessionTemplateName: string | null;
  sessionTemplateNamespace: string | null;
  useCaseMode: 'lead_capture' | 'direct_sales' | 'customer_support';
}

interface WhatsappLead {
  id: string;
  senderPhone: string | null;
  senderName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: string | null;
  rawMessage: string | null;
  extractedData: Record<string, any> | null;
  status: string;
  receivedAt: string;
  createdAt: string;
  direction: 'incoming' | 'outgoing' | null;
  flowSessionId?: string | null;
  attachments?: WhatsappAttachment[];
}

interface WhatsappAttachment {
  id: string;
  fileName: string | null;
  fileType: string | null;
  mimeType: string | null;
  fileSize: number | null;
  filePath: string | null;
  caption: string | null;
}

interface JourneySummary {
  flow_session_id: string;
  flow_name: string;
  message_count: number;
  first_message_at: string;
  last_message_at: string;
}

interface ConversationSummary {
  sender_phone: string;
  session_id: number;
  sender_name: string | null;
  message_count: number;
  last_message_at: string;
  first_message_at: string;
  journeys: JourneySummary[];
}

interface WhatsappFlow {
  id: string;
  name: string;
  description: string | null;
  isActive: string;
  triggerKeyword: string | null;
  fallbackToAI: string;
  adaptiveMode: string;
  sessionTimeout: number | null;
  completionMessage: string | null;
  createdAt: string;
}

interface WhatsappFlowStep {
  id: string;
  flowId: string;
  stepKey: string;
  stepOrder: number;
  type: string;
  prompt: string;
  options: {
    buttons?: { id: string; title: string }[];
    dropdownItems?: { id: string; title: string; value: string; followUpPrompt?: string }[];
    sections?: { title: string; rows: { id: string; title: string; description?: string }[] }[];
    buttonText?: string;
    requiredFields?: string[];
    selectedFields?: { fieldKey: string; fieldLabel: string; isRequired: boolean }[];
    documentTypes?: { docType: string; label: string; isMandatory: boolean }[];
  } | null;
  nextStepMapping: Record<string, string> | null;
  defaultNextStep: string | null;
  saveToField: string | null;
  paused: boolean;
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
  defaultCrmFieldKey: string | null;
  allowedValues: string[] | null;
}

interface SelectedConversation {
  senderPhone: string;
  sessionStart: string;
  sessionEnd: string;
  senderName: string | null;
  flowSessionId?: string;
  journeyName?: string;
}

function friendlySyncError(error: string | null | undefined): string {
  return formatCrmSyncError(error);
}

type ConditionalMappingItem = { id: string; title: string; value: string; followUpPrompt?: string };
type ConditionalMapping = { key: string; items: ConditionalMappingItem[] };
type ParseExcelStats = {
  totalRows: number;
  validRows: number;
  newKeys: number;
  newItems: number;
  duplicatesSkipped: number;
  invalidSkipped: number;
};
type ParseExcelResult = {
  mergedMappings: ConditionalMapping[];
  stats: ParseExcelStats;
  preview: { key: string; addedItems: { title: string; value: string }[] }[];
  errors: string[];
};

const slugifyOptionId = (title: string, fallbackIndex: number): string =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `opt_${fallbackIndex}`;

const normaliseForCompare = (s: string): string => s.trim().toLowerCase();

const LABEL_HEADERS = ["label", "title", "option", "name"];
const VALUE_HEADERS = ["value", "stored value", "stored_value"];
const FOLLOWUP_HEADERS = ["followupprompt", "followup", "follow_up", "follow up", "follow-up", "follow up prompt", "followup prompt"];

function parseConditionalMappingsRows(
  rows: Record<string, unknown>[],
  parentFields: string[],
  existingMappings: ConditionalMapping[],
): ParseExcelResult {
  const stats: ParseExcelStats = {
    totalRows: rows.length,
    validRows: 0,
    newKeys: 0,
    newItems: 0,
    duplicatesSkipped: 0,
    invalidSkipped: 0,
  };
  const errors: string[] = [];

  const headerMap = new Map<string, string>();
  if (rows.length > 0) {
    for (const rawHeader of Object.keys(rows[0])) {
      headerMap.set(rawHeader.trim().toLowerCase(), rawHeader);
    }
  }

  const findHeader = (candidates: string[]): string | undefined => {
    for (const cand of candidates) {
      const hit = headerMap.get(cand.toLowerCase());
      if (hit) return hit;
    }
    return undefined;
  };

  const parentHeaders: (string | undefined)[] = parentFields.map(f => findHeader([f, f.toLowerCase()]));
  const labelHeader = findHeader(LABEL_HEADERS);
  const valueHeader = findHeader(VALUE_HEADERS);
  const followUpHeader = findHeader(FOLLOWUP_HEADERS);

  // Fallbacks for single-parent case: allow "Key" or "Parent"
  if (parentFields.length === 1 && !parentHeaders[0]) {
    parentHeaders[0] = findHeader(["key", "parent"]);
  }

  if (!labelHeader) {
    errors.push(`Missing required column "Label" (or Title/Option/Name).`);
  }
  parentFields.forEach((f, i) => {
    if (!parentHeaders[i]) errors.push(`Missing required column "${f}" for parent field.`);
  });
  if (errors.length > 0) {
    return { mergedMappings: existingMappings, stats, preview: [], errors };
  }

  // Clone existing mappings (deep enough for our edits)
  const merged: ConditionalMapping[] = existingMappings.map(m => ({
    key: m.key,
    items: m.items.map(i => ({ ...i })),
  }));

  // Index existing keys (case-insensitive) → index into `merged`
  const keyIndex = new Map<string, number>();
  merged.forEach((m, idx) => {
    if (m.key.trim()) keyIndex.set(normaliseForCompare(m.key), idx);
  });

  // Per-key set of seen title+value (case-insensitive)
  const itemSeen = new Map<number, Set<string>>();
  const ensureSeen = (idx: number): Set<string> => {
    let s = itemSeen.get(idx);
    if (!s) {
      s = new Set<string>();
      merged[idx].items.forEach(it => {
        s!.add(`${normaliseForCompare(it.title)}|${normaliseForCompare(it.value || it.title)}`);
      });
      itemSeen.set(idx, s);
    }
    return s;
  };

  const previewByKey = new Map<string, { title: string; value: string }[]>();

  rows.forEach((row, rowIdx) => {
    const keyParts: string[] = [];
    let missingPart = false;
    for (let i = 0; i < parentFields.length; i++) {
      const header = parentHeaders[i]!;
      const raw = row[header];
      const part = raw == null ? "" : String(raw).trim();
      if (!part) {
        missingPart = true;
        break;
      }
      keyParts.push(part);
    }
    const title = String(row[labelHeader!] ?? "").trim();
    if (missingPart || !title) {
      stats.invalidSkipped++;
      return;
    }
    stats.validRows++;

    const composedKey = keyParts.join("|");
    const normalisedKey = normaliseForCompare(composedKey);
    let mappingIdx = keyIndex.get(normalisedKey);
    if (mappingIdx === undefined) {
      merged.push({ key: composedKey, items: [] });
      mappingIdx = merged.length - 1;
      keyIndex.set(normalisedKey, mappingIdx);
      stats.newKeys++;
    }
    const seen = ensureSeen(mappingIdx);

    const rawValue = valueHeader ? String(row[valueHeader] ?? "").trim() : "";
    const value = rawValue || title;
    const dupKey = `${normaliseForCompare(title)}|${normaliseForCompare(value)}`;
    if (seen.has(dupKey)) {
      stats.duplicatesSkipped++;
      return;
    }
    seen.add(dupKey);

    const followUpPrompt = followUpHeader ? String(row[followUpHeader] ?? "").trim() : "";
    const existingItemCount = merged[mappingIdx].items.length;
    const newItem: ConditionalMappingItem = {
      id: slugifyOptionId(title, existingItemCount),
      title,
      value,
    };
    if (followUpPrompt) newItem.followUpPrompt = followUpPrompt;
    merged[mappingIdx].items.push(newItem);
    stats.newItems++;

    const previewKey = merged[mappingIdx].key;
    const arr = previewByKey.get(previewKey) ?? [];
    arr.push({ title, value });
    previewByKey.set(previewKey, arr);
  });

  const preview = Array.from(previewByKey.entries()).map(([key, addedItems]) => ({ key, addedItems }));
  return { mergedMappings: merged, stats, preview, errors };
}

async function readWorkbookFromFile(file: File): Promise<Record<string, unknown>[]> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
}

export default function WhatsApp() {
  const [location, setLocation] = useLocation();
  const [copied, setCopied] = useState(false);
  const [selectedLead, setSelectedLead] = useState<WhatsappLead | null>(null);
  const [expandedConversations, setExpandedConversations] = useState<Set<string>>(new Set());
  const [journeyVisibleCount, setJourneyVisibleCount] = useState<Record<string, number>>({});
  const [leadDetailOpen, setLeadDetailOpen] = useState(false);
  const [documentsDialogLead, setDocumentsDialogLead] = useState<WhatsappLead | null>(null);
  const [documentsDialogAttachments, setDocumentsDialogAttachments] = useState<any[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<SelectedConversation | null>(null);
  const [conversationSearch, setConversationSearch] = useState("");
  const [debouncedConversationSearch, setDebouncedConversationSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [allMessages, setAllMessages] = useState<WhatsappLead[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const isInitialLoadRef = useRef(true);
  const { toast } = useToast();

  const { data: currentUser } = useQuery<MeResponseDto>({ queryKey: ["/api/auth/me"] });
  const isSingleProduct = useMemo(() => {
    const ba = currentUser?.businessAccount;
    if (!ba) return false;
    const count = [ba.chroneyEnabled, ba.whatsappEnabled, ba.instagramEnabled, ba.facebookEnabled].filter(Boolean).length;
    return count === 1;
  }, [currentUser]);

  // The sidebar only lists Campaigns/Templates/Contact Groups in its single-agent layout, so
  // on a multi-agent account this hub is the only place the marketing feature can be reached.
  // Derived exactly as the sidebar derives it, so the two can never disagree.
  const hasWhatsappMarketingEnabled = useMemo(() => {
    const ba = currentUser?.businessAccount;
    return ba?.whatsappEnabled === true && ba?.whatsappMarketingEnabled === true;
  }, [currentUser]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedConversationSearch(conversationSearch), 300);
    return () => clearTimeout(timer);
  }, [conversationSearch]);

  const currentPage = location.includes("whatsapp-conversations") 
    ? "conversations" 
    : location.includes("whatsapp-lead-capture-settings")
    ? "lead-capture-settings"
    : location.includes("whatsapp-flows")
    ? "flows"
    : location.includes("whatsapp-config")
    ? "config"
    : location.includes("whatsapp-smart-replies")
    ? "smart-replies"
    : location.includes("whatsapp-whitelist")
    ? "whitelist"
    : location.includes("whatsapp-leads") 
    ? "leads" 
    : "home";

  const [msg91AuthKey, setMsg91AuthKey] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [autoSync, setAutoSync] = useState(false);
  const [leadCaptureEnabled, setLeadCaptureEnabled] = useState(true);
  const [leadGenerationMode, setLeadGenerationMode] = useState("first_message");
  const [requireName, setRequireName] = useState(false);
  const [requirePhone, setRequirePhone] = useState(false);
  const [requireEmail, setRequireEmail] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [newApplicationCooldownDays, setNewApplicationCooldownDays] = useState(7);
  const [leadsPage, setLeadsPage] = useState(1);
  const [leadsSearchInput, setLeadsSearchInput] = useState("");
  const [leadsSearch, setLeadsSearch] = useState("");
  const [leadToDelete, setLeadToDelete] = useState<WhatsappLead | null>(null);
  const [conversationToDelete, setConversationToDelete] = useState<ConversationSummary | null>(null);
  const leadsPerPage = 10;
  const [leadsDateFilter, setLeadsDateFilter] = useState<"all" | "today" | "yesterday" | "last7" | "last30" | "custom">("all");
  const [leadsCustomFrom, setLeadsCustomFrom] = useState<Date | undefined>(undefined);
  const [leadsCustomTo, setLeadsCustomTo] = useState<Date | undefined>(undefined);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [leadsViewMode, setLeadsViewMode] = useState<"summary" | "full">("summary");
  const [msg91IntegratedNumberId, setMsg91IntegratedNumberId] = useState("");
  const [sessionTemplateName, setSessionTemplateName] = useState("");
  const [sessionTemplateNamespace, setSessionTemplateNamespace] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setLeadsSearch(leadsSearchInput.trim());
      setLeadsPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [leadsSearchInput]);

  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ["/api/whatsapp/settings"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json() as Promise<{ settings: WhatsappSettings; webhookUrl: string; webhookSecret?: string }>;
    },
  });

  const getLeadsDateRange = (): { dateFrom?: string; dateTo?: string } => {
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    if (leadsDateFilter === "today") {
      return { dateFrom: startOfDay(now).toISOString(), dateTo: endOfDay(now).toISOString() };
    } else if (leadsDateFilter === "yesterday") {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return { dateFrom: startOfDay(y).toISOString(), dateTo: endOfDay(y).toISOString() };
    } else if (leadsDateFilter === "last7") {
      const d = new Date(now); d.setDate(d.getDate() - 6);
      return { dateFrom: startOfDay(d).toISOString(), dateTo: endOfDay(now).toISOString() };
    } else if (leadsDateFilter === "last30") {
      const d = new Date(now); d.setDate(d.getDate() - 29);
      return { dateFrom: startOfDay(d).toISOString(), dateTo: endOfDay(now).toISOString() };
    } else if (leadsDateFilter === "custom" && leadsCustomFrom) {
      return {
        dateFrom: startOfDay(leadsCustomFrom).toISOString(),
        dateTo: leadsCustomTo ? endOfDay(leadsCustomTo).toISOString() : endOfDay(leadsCustomFrom).toISOString(),
      };
    }
    return {};
  };

  const { data: leadsData, isLoading: leadsLoading, isFetching: leadsFetching } = useQuery({
    queryKey: ["/api/whatsapp/leads", leadsPage, leadsDateFilter, leadsCustomFrom?.toISOString(), leadsCustomTo?.toISOString(), leadsSearch],
    queryFn: async () => {
      const offset = (leadsPage - 1) * leadsPerPage;
      const { dateFrom, dateTo } = getLeadsDateRange();
      const params = new URLSearchParams({ limit: String(leadsPerPage), offset: String(offset) });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (leadsSearch.trim()) params.set("search", leadsSearch.trim());
      const res = await fetch(`/api/whatsapp/leads?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json() as Promise<{ leads: WhatsappLead[]; total: number }>;
    },
  });

  const deleteLeadMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const res = await fetch(`/api/whatsapp/leads/${leadId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/leads"] });
      toast({ title: "Lead deleted successfully" });
      setLeadToDelete(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete lead", description: error.message, variant: "destructive" });
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async (conv: ConversationSummary) => {
      const params = new URLSearchParams();
      params.set('sessionStart', conv.first_message_at);
      params.set('sessionEnd', conv.last_message_at);
      const res = await fetch(`/api/whatsapp/conversations/${encodeURIComponent(conv.sender_phone)}?${params.toString()}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete conversation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/leads"] });
      toast({ title: "Session deleted successfully" });
      setConversationToDelete(null);
      if (selectedConversation?.senderPhone === conversationToDelete?.sender_phone) {
        setSelectedConversation(null);
      }
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete session", description: error.message, variant: "destructive" });
    },
  });

  const { data: crmSettingsData } = useQuery({
    queryKey: ["/api/custom-crm/settings"],
    queryFn: async () => {
      const res = await fetch("/api/custom-crm/settings", { credentials: "include" });
      if (!res.ok) return null;
      return res.json() as Promise<{ enabled: boolean; autoSyncEnabled: boolean }>;
    },
    staleTime: 0,
  });
  const customCrmEnabled = !!crmSettingsData?.enabled;

  const syncWhatsappLeadMutation = useMutation({
    mutationFn: async (leadId: string) => {
      const res = await fetch(`/api/custom-crm/sync-lead/${leadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ leadType: "whatsapp" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/leads"] });
      toast({ title: "Lead synced to CRM successfully" });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/leads"] });
      toast({ title: "CRM sync failed", description: friendlySyncError(error.message), variant: "destructive" });
    },
  });

  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [showBulkSyncConfirm, setShowBulkSyncConfirm] = useState(false);

  const generateTestLeadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/custom-crm/generate-test-lead", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate test lead");
      return data as { success: boolean; leadId: string; message: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/leads"] });
      toast({ title: "Test lead created", description: "A fully-populated test lead has been added. You can now sync it to CRM." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create test lead", description: error.message, variant: "destructive" });
    },
  });

  const syncAllWhatsappLeadsMutation = useMutation({
    mutationFn: async () => {
      setBulkSyncing(true);
      const res = await fetch("/api/custom-crm/sync-all-whatsapp-leads", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk sync failed");
      return data as { synced: number; failed: number; total: number; message: string };
    },
    onSuccess: (data) => {
      setBulkSyncing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/leads"] });
      toast({
        title: "Bulk CRM Sync Complete",
        description: `${data.synced} synced, ${data.failed} failed out of ${data.total} leads`,
      });
    },
    onError: (error: Error) => {
      setBulkSyncing(false);
      toast({ title: "Bulk CRM sync failed", description: error.message, variant: "destructive" });
    },
  });

  const { data: leadDetailData } = useQuery({
    queryKey: ["/api/whatsapp/leads", selectedLead?.id],
    queryFn: async () => {
      if (!selectedLead?.id) return null;
      const res = await fetch(`/api/whatsapp/leads/${selectedLead.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch lead details");
      return res.json() as Promise<{ lead: WhatsappLead; attachments: WhatsappAttachment[] }>;
    },
    enabled: !!selectedLead?.id,
  });

  // ---- Verification (Task #5) ------------------------------------------
  const { data: verificationRuleSets } = useQuery<{ ruleSets: { id: string; name: string; isActive: boolean }[] }>({
    queryKey: ["/api/verification/rule-sets"],
    queryFn: async () => {
      const res = await fetch("/api/verification/rule-sets", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch rule sets");
      return res.json();
    },
    enabled: !!selectedLead?.id,
  });

  const [selectedVerificationRuleSetId, setSelectedVerificationRuleSetId] = useState<string>("");
  useEffect(() => {
    if (!selectedVerificationRuleSetId && verificationRuleSets?.ruleSets?.length) {
      const firstActive = verificationRuleSets.ruleSets.find(r => r.isActive) || verificationRuleSets.ruleSets[0];
      setSelectedVerificationRuleSetId(firstActive.id);
    }
  }, [verificationRuleSets, selectedVerificationRuleSetId]);

  const runVerificationMutation = useMutation({
    mutationFn: async (vars: { leadId: string; ruleSetId: string; notify: boolean }) => {
      const res = await fetch(`/api/whatsapp/leads/${vars.leadId}/run-verification`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleSetId: vars.ruleSetId, notify: vars.notify }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Verification failed");
      }
      return res.json() as Promise<{ result: any; notified: boolean | null }>;
    },
    onSuccess: (data) => {
      toast({
        title: `Verification: ${data.result.verdict}`,
        description: `${data.result.counts.pass}/${data.result.counts.total} checks passed${data.notified ? " · Sent to customer" : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/leads", selectedLead?.id] });
    },
    onError: (err: Error) => toast({ title: "Verification error", description: err.message, variant: "destructive" }),
  });

  const CONVERSATIONS_PAGE_SIZE = 20;
  const conversationsListRef = useRef<HTMLDivElement>(null);
  const {
    data: conversationsPagesData,
    isLoading: conversationsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["/api/whatsapp/conversations", { search: debouncedConversationSearch }],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams();
      params.set('limit', String(CONVERSATIONS_PAGE_SIZE));
      params.set('offset', String(pageParam));
      if (debouncedConversationSearch) params.set('search', debouncedConversationSearch);
      const res = await fetch(`/api/whatsapp/conversations?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json() as Promise<{ conversations: ConversationSummary[]; total: number }>;
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.conversations.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    initialPageParam: 0,
  });
  const conversationsData = useMemo(() => {
    if (!conversationsPagesData) return undefined;
    const allConversations = conversationsPagesData.pages.flatMap(p => p.conversations);
    const total = conversationsPagesData.pages[0]?.total ?? 0;
    return { conversations: allConversations, total };
  }, [conversationsPagesData]);

  const { data: conversationMessagesData, isLoading: messagesLoading, refetch: refetchMessages, isFetching: messagesRefetching } = useQuery({
    queryKey: ["/api/whatsapp/conversations", selectedConversation?.senderPhone, selectedConversation?.flowSessionId, selectedConversation?.sessionStart, selectedConversation?.sessionEnd],
    queryFn: async () => {
      if (!selectedConversation) return null;
      let url = `/api/whatsapp/conversations/${encodeURIComponent(selectedConversation.senderPhone)}`;
      const params = new URLSearchParams();
      if (selectedConversation.flowSessionId) {
        params.set('flowSessionId', selectedConversation.flowSessionId);
      } else if (selectedConversation.sessionStart && selectedConversation.sessionEnd) {
        params.set('sessionStart', selectedConversation.sessionStart);
        params.set('sessionEnd', selectedConversation.sessionEnd);
      }
      params.set('limit', '20');
      if (params.toString()) {
        url += `?${params.toString()}`;
      }
      const res = await fetch(url, { 
        credentials: "include",
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      if (!res.ok) throw new Error("Failed to fetch conversation messages");
      return res.json() as Promise<{ 
        messages: WhatsappLead[]; 
        senderName: string | null;
        flowSessions: { id: string; flowName: string; createdAt: string | null }[];
        hasMore: boolean;
        oldestTimestamp: string | null;
      }>;
    },
    enabled: !!selectedConversation,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  // Lead Fields Query
  const { data: leadFieldsData, isLoading: leadFieldsLoading } = useQuery({
    queryKey: ["/api/whatsapp/lead-fields"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/lead-fields", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch lead fields");
      return res.json() as Promise<{ fields: LeadField[] }>;
    },
  });

  const displayedLeadFields = useMemo(() => {
    return (leadFieldsData?.fields || [])
      .filter((f: LeadField) => f.isEnabled)
      .sort((a: LeadField, b: LeadField) => a.displayOrder - b.displayOrder)
      .slice(0, 2);
  }, [leadFieldsData]);

  const fullDataColumns = useMemo(() => {
    if (!leadsData?.leads.length) return [];
    const keySet = new Set<string>();
    leadsData.leads.forEach(lead => {
      const ed = (lead.extractedData as Record<string, any>) || {};
      Object.keys(ed).forEach(k => {
        if (!k.startsWith('_') && k !== 'customer phone') keySet.add(k);
      });
    });
    return Array.from(keySet).sort();
  }, [leadsData?.leads]);

  const formatColLabel = (key: string) =>
    key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const isFlowPlaceholder = (v: string | null | undefined) => v?.startsWith('__flow_pending__');

  const getLeadFieldValue = (lead: WhatsappLead, fieldKey: string): string | null => {
    const directMap: Record<string, string | null | undefined> = {
      customer_name: isFlowPlaceholder(lead.customerName) ? null : lead.customerName,
      customer_phone: lead.customerPhone,
      customer_email: lead.customerEmail,
      notes: lead.notes,
    };
    if (fieldKey in directMap) return directMap[fieldKey] ?? null;
    return (lead.extractedData as Record<string, any>)?.[fieldKey] ?? null;
  };

  // State for add/edit field dialog
  const [showAddFieldDialog, setShowAddFieldDialog] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [newFieldCrmKey, setNewFieldCrmKey] = useState("");
  const [editCrmKeyFieldId, setEditCrmKeyFieldId] = useState<string | null>(null);
  const [editCrmKeyValue, setEditCrmKeyValue] = useState("");
  const [editAllowedValues, setEditAllowedValues] = useState<string[]>([]);
  const [editAllowedInput, setEditAllowedInput] = useState("");
  const [newFieldAllowedValues, setNewFieldAllowedValues] = useState<string[]>([]);
  const [newFieldAllowedInput, setNewFieldAllowedInput] = useState("");

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<WhatsappSettings>) => {
      return await apiRequest("PUT", "/api/whatsapp/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/settings"] });
      toast({
        title: "Settings saved",
        description: "WhatsApp settings have been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    },
  });

  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      setTestResult(null);
      const res = await fetch("/api/whatsapp/test-connection", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ message: "Connection test failed" }));
        throw new Error(errorData.message || errorData.error || "Connection test failed");
      }
      return res.json() as Promise<{ success: boolean; message: string }>;
    },
    onSuccess: (data) => {
      setTestResult(data);
      toast({
        title: data.success ? "Connection Successful" : "Connection Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error: any) => {
      setTestResult({ success: false, message: error.message || "Test failed" });
      toast({
        title: "Error",
        description: error.message || "Failed to test connection",
        variant: "destructive",
      });
    },
  });

  // Lead Field Mutations
  const createFieldMutation = useMutation({
    mutationFn: async (data: { fieldKey: string; fieldLabel: string; fieldType: string; defaultCrmFieldKey?: string; allowedValues?: string[] }) => {
      return await apiRequest("POST", "/api/whatsapp/lead-fields", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/lead-fields"] });
      setShowAddFieldDialog(false);
      setNewFieldLabel("");
      setNewFieldType("text");
      setNewFieldCrmKey("");
      setNewFieldAllowedValues([]);
      setNewFieldAllowedInput("");
      toast({ title: "Field added", description: "New lead field has been created." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create field", variant: "destructive" });
    },
  });

  const updateFieldMutation = useMutation({
    mutationFn: async ({ fieldId, ...data }: { fieldId: string; isEnabled?: boolean; isRequired?: boolean; defaultCrmFieldKey?: string | null; allowedValues?: string[] | null }) => {
      return await apiRequest("PUT", `/api/whatsapp/lead-fields/${fieldId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/lead-fields"] });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update field", variant: "destructive" });
    },
  });

  const deleteFieldMutation = useMutation({
    mutationFn: async (fieldId: string) => {
      return await apiRequest("DELETE", `/api/whatsapp/lead-fields/${fieldId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/lead-fields"] });
      toast({ title: "Field deleted", description: "Lead field has been removed." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete field", variant: "destructive" });
    },
  });

  // Initialize form state from settings data
  useEffect(() => {
    if (settingsData?.settings) {
      const settings = settingsData.settings;
      setAutoSync(settings.autoSyncToLeadsquared ?? false);
      setLeadCaptureEnabled(settings.leadCaptureEnabled ?? true);
      setLeadGenerationMode(settings.leadGenerationMode ?? "first_message");
      setRequireName(settings.requireName ?? false);
      setRequirePhone(settings.requirePhone ?? false);
      setRequireEmail(settings.requireEmail ?? false);
      setAutoReplyEnabled(settings.autoReplyEnabled ?? false);
      setMsg91IntegratedNumberId(settings.msg91IntegratedNumberId ?? "");
      setSessionTemplateName(settings.sessionTemplateName ?? "");
      setSessionTemplateNamespace(settings.sessionTemplateNamespace ?? "");
      setNewApplicationCooldownDays(settings.newApplicationCooldownDays ?? 7);
    }
  }, [settingsData]);

  useEffect(() => {
    if (selectedConversation) {
      setAllMessages([]);
      setHasMoreMessages(false);
      setLoadingOlderMessages(false);
      isInitialLoadRef.current = true;
    }
  }, [selectedConversation]);

  useEffect(() => {
    if (conversationMessagesData?.messages?.length && isInitialLoadRef.current) {
      setAllMessages(conversationMessagesData.messages);
      setHasMoreMessages(conversationMessagesData.hasMore ?? false);
    }
  }, [conversationMessagesData]);

  useEffect(() => {
    if (allMessages.length > 0 && isInitialLoadRef.current) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
        isInitialLoadRef.current = false;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [allMessages]);

  const loadOlderMessages = async () => {
    if (!selectedConversation || !allMessages.length || loadingOlderMessages || !hasMoreMessages) return;
    setLoadingOlderMessages(true);
    try {
      const oldestTimestamp = allMessages[0].receivedAt;
      let url = `/api/whatsapp/conversations/${encodeURIComponent(selectedConversation.senderPhone)}`;
      const params = new URLSearchParams();
      if (selectedConversation.flowSessionId) {
        params.set('flowSessionId', selectedConversation.flowSessionId);
      } else if (selectedConversation.sessionStart && selectedConversation.sessionEnd) {
        params.set('sessionStart', selectedConversation.sessionStart);
        params.set('sessionEnd', selectedConversation.sessionEnd);
      }
      params.set('limit', '20');
      params.set('before', oldestTimestamp);
      url += `?${params.toString()}`;

      const container = messagesContainerRef.current;
      const prevScrollHeight = container?.scrollHeight || 0;

      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch older messages");
      const data = await res.json() as { messages: WhatsappLead[]; hasMore: boolean; oldestTimestamp: string | null };

      setAllMessages(prev => [...data.messages, ...prev]);
      setHasMoreMessages(data.hasMore);

      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        }
      });
    } catch (error) {
      console.error("Error loading older messages:", error);
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (container.scrollTop < 50 && hasMoreMessages && !loadingOlderMessages) {
        loadOlderMessages();
      }
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [hasMoreMessages, loadingOlderMessages, allMessages, selectedConversation]);

  const handleSaveSettings = () => {
    updateSettingsMutation.mutate({
      // Send the key only when the user actually typed a new one. The server treats a blank or
      // absent value as "keep the existing key", so saving other settings cannot wipe it.
      ...(msg91AuthKey.trim() ? { msg91AuthKey: msg91AuthKey.trim() } : {}),
      whatsappNumber: whatsappNumber || settingsData?.settings.whatsappNumber,
      autoSyncToLeadsquared: autoSync,
      leadCaptureEnabled,
      leadGenerationMode,
      requireName,
      requirePhone,
      requireEmail,
      minFieldsRequired: 1, // Hardcoded to 1 - not user configurable
      autoReplyEnabled,
      msg91IntegratedNumberId,
      sessionTemplateName,
      sessionTemplateNamespace,
    });
  };

  const handleCopyWebhook = async () => {
    if (settingsData?.webhookUrl) {
      // The signed URL is fetched only at the moment the user asks for it, so the secret is
      // never part of the general settings payload sitting in the query cache.
      let fullUrl = settingsData.webhookUrl;
      try {
        const res = await apiRequest("GET", "/api/whatsapp/settings/webhook-url");
        if (res?.webhookUrl) fullUrl = res.webhookUrl;
      } catch {
        toast({
          title: "Could not build the full webhook URL",
          description: "Copied the address without its secret — inbound messages will be rejected until the secret is included.",
          variant: "destructive",
        });
      }
      navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied",
        description: "Webhook URL copied to clipboard",
      });
    }
  };

  const handleViewLead = (lead: WhatsappLead) => {
    setSelectedLead(lead);
    setLeadDetailOpen(true);
  };

  const hasDocuments = (lead: any) => {
    if ((lead as any).attachmentCount > 0) return true;
    if (!lead.extractedData) return false;
    const data = lead.extractedData as Record<string, any>;
    return !!data.bank_statement_password;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      new: "default",
      processing: "secondary",
      completed: "outline",
      rejected: "destructive",
    };
    return <Badge variant={variants[status] || "default"}>{status}</Badge>;
  };

  return (
    <div className="min-h-screen bg-gray-50 relative overflow-hidden">
      {currentPage === "home" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
          <MessageCircle className="w-[400px] h-[400px] text-green-500/[0.04]" strokeWidth={1} />
        </div>
      )}
      <header className="bg-white border-b px-4 py-3 flex items-center gap-4 relative z-10">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-green-500">
            <MessageCircle className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold">WhatsApp</h1>
        </div>
      </header>


      <div className="p-6 relative z-10">
        {currentPage === "home" && (
          <WhatsAppHub marketingEnabled={hasWhatsappMarketingEnabled} />
        )}

        {currentPage === "config" && (
            <div className="space-y-6">
              <Card className="border-green-200 bg-green-50/30">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="h-5 w-5 text-green-600" />
                        <h3 className="text-lg font-semibold">WhatsApp AI Agent</h3>
                      </div>
                      <p className="text-sm text-gray-600">
                        Enable or disable the WhatsApp AI Agent for this business. When disabled, incoming messages will not be processed.
                      </p>
                    </div>
                    <Switch
                      checked={settingsData?.settings?.whatsappEnabled !== "false"}
                      onCheckedChange={(checked) => {
                        updateSettingsMutation.mutate({ whatsappEnabled: checked ? "true" : "false" } as any);
                      }}
                    />
                  </div>
                </CardContent>
              </Card>


              <Card>
                <CardHeader>
                  <CardTitle>Webhook URL</CardTitle>
                  <CardDescription>
                    Copy this URL and configure it in your MSG91 dashboard to receive WhatsApp messages.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Input
                      value={settingsData?.settings?.webhookSecretConfigured
                        ? `${settingsData.webhookUrl}?secret=••••••••`
                        : (settingsData?.webhookUrl || "Loading...")}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopyWebhook}
                      disabled={!settingsData?.webhookUrl}
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    In MSG91: Go to WhatsApp → Webhook (New) → Add this URL (includes security token)
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>MSG91 Settings</CardTitle>
                  <CardDescription>
                    Configure your MSG91 credentials for receiving and processing WhatsApp messages.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="authKey">MSG91 Auth Key</Label>
                      <Input
                        id="authKey"
                        type="password"
                        placeholder={settingsData?.settings.msg91AuthKeyConfigured ? "•••••••• (saved — leave blank to keep it)" : "Enter your MSG91 auth key"}
                        value={msg91AuthKey}
                        onChange={(e) => setMsg91AuthKey(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="whatsappNumber">WhatsApp Number</Label>
                      <Input
                        id="whatsappNumber"
                        placeholder={settingsData?.settings.whatsappNumber || "+1234567890"}
                        value={whatsappNumber}
                        onChange={(e) => setWhatsappNumber(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="space-y-0.5">
                      <Label>Auto-sync to LeadSquared</Label>
                      <p className="text-sm text-gray-500">
                        Automatically push captured leads to LeadSquared CRM
                      </p>
                    </div>
                    <Switch
                      checked={autoSync}
                      onCheckedChange={setAutoSync}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>AI Auto-Reply</CardTitle>
                  <CardDescription>
                    Enable AI to automatically respond to incoming WhatsApp messages using your business context and knowledge base.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Enable AI Auto-Reply</Label>
                      <p className="text-sm text-gray-500">
                        AI will respond to every incoming message using your training data
                      </p>
                    </div>
                    <Switch
                      checked={autoReplyEnabled}
                      onCheckedChange={setAutoReplyEnabled}
                    />
                  </div>

                  {autoReplyEnabled && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="integratedNumberId">MSG91 Integrated Number ID</Label>
                        <Input
                          id="integratedNumberId"
                          placeholder="Enter your MSG91 Integrated Number ID"
                          value={msg91IntegratedNumberId}
                          onChange={(e) => setMsg91IntegratedNumberId(e.target.value)}
                        />
                        <p className="text-sm text-gray-500">
                          Find this in your MSG91 dashboard under WhatsApp &gt; Integrated Numbers
                        </p>
                      </div>

                      <div className="border-t pt-4 space-y-3">
                        <h4 className="text-sm font-semibold text-gray-700">24-Hour Session Template</h4>
                        <p className="text-xs text-gray-500">
                          WhatsApp only allows free-form messages within 24 hours of the customer's last message. After that, you must use an approved template. Configure your re-engagement template below.
                        </p>
                        <div className="space-y-2">
                          <Label htmlFor="sessionTemplateName">Template Name</Label>
                          <Input
                            id="sessionTemplateName"
                            placeholder="e.g. re_engagement_hello"
                            value={sessionTemplateName}
                            onChange={(e) => setSessionTemplateName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="sessionTemplateNamespace">Template Namespace (optional)</Label>
                          <Input
                            id="sessionTemplateNamespace"
                            placeholder="e.g. your_namespace"
                            value={sessionTemplateNamespace}
                            onChange={(e) => setSessionTemplateNamespace(e.target.value)}
                          />
                          <p className="text-xs text-gray-500">
                            Only needed if MSG91 requires a namespace for your template
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex gap-3 items-center">
                    <Button
                      onClick={handleSaveSettings}
                      disabled={updateSettingsMutation.isPending}
                    >
                      {updateSettingsMutation.isPending ? "Saving..." : "Save Settings"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => testConnectionMutation.mutate()}
                      disabled={testConnectionMutation.isPending || !settingsData?.settings.msg91AuthKeyConfigured}
                    >
                      {testConnectionMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        "Test Connection"
                      )}
                    </Button>
                    {testResult && (
                      <div className={`flex items-center gap-1 text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                        {testResult.success ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                        <span>{testResult.success ? 'Connected' : 'Failed'}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>How It Works</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
                    <li>Salesman sends customer details via WhatsApp to your business number</li>
                    <li>MSG91 forwards the message to your webhook URL</li>
                    <li>AI extracts customer information (name, phone, email, loan details)</li>
                    <li>Lead is stored in your dashboard with any attached documents</li>
                    <li>Optionally synced to LeadSquared for follow-up</li>
                  </ol>
                </CardContent>
              </Card>

            </div>
        )}

        {currentPage === "whitelist" && (
          <WhitelistSection 
            settingsData={settingsData}
            updateSettingsMutation={updateSettingsMutation}
          />
        )}

        {currentPage === "flows" && (
          <div className="space-y-6">
            <FlowBuilderSection />
          </div>
        )}

        {currentPage === "conversations" && (
          <div className="flex rounded-2xl shadow-sm border overflow-hidden bg-white" style={{ height: 'calc(100vh - 90px)' }}>
            {/* Left Panel - Conversation List */}
            <div className={`${selectedConversation ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[380px] md:min-w-[380px] border-r`}>
              <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-2.5 shrink-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-white">Conversations</h2>
                  {conversationsData && conversationsData.total > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-white/20 text-white text-xs font-medium">
                      {conversationsData.total}
                    </span>
                  )}
                </div>
              </div>

              <div className="px-3 py-2 border-b shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by name or phone..."
                    value={conversationSearch}
                    onChange={(e) => setConversationSearch(e.target.value)}
                    className="pl-9 h-9 text-sm bg-gray-50 border-gray-200 focus:bg-white"
                  />
                  {conversationSearch && (
                    <button
                      onClick={() => setConversationSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div
                ref={conversationsListRef}
                className="flex-1 overflow-y-auto divide-y"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  if (el.scrollHeight - el.scrollTop - el.clientHeight < 200 && hasNextPage && !isFetchingNextPage) {
                    fetchNextPage();
                  }
                }}
              >
                {conversationsLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mx-auto mb-2" />
                      <p className="text-gray-500 text-sm">Loading conversations...</p>
                    </div>
                  </div>
                ) : !conversationsData?.conversations.length ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="text-center">
                      <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <MessagesSquare className="h-10 w-10 text-gray-300" />
                      </div>
                      <p className="text-gray-600 font-medium">No conversations yet</p>
                      <p className="text-gray-400 text-sm mt-1">Received WhatsApp messages will appear here</p>
                    </div>
                  </div>
                ) : (
                  conversationsData.conversations.map((conversation) => {
                    const sessionKey = `${conversation.sender_phone}-${conversation.session_id}`;
                    const sessionDate = format(parseUTCDate(conversation.first_message_at), "MMM d, yyyy");
                    const isToday = format(parseUTCDate(conversation.last_message_at), "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
                    const hasJourneys = conversation.journeys && conversation.journeys.length > 0;
                    const isExpanded = expandedConversations.has(sessionKey);
                    const isActive = selectedConversation?.senderPhone === conversation.sender_phone &&
                      selectedConversation?.sessionStart === conversation.first_message_at;

                    return (
                      <div key={sessionKey}>
                        <div
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all duration-200 group ${isActive ? 'bg-emerald-50 border-l-4 border-l-emerald-500' : 'hover:bg-gray-50 border-l-4 border-l-transparent'}`}
                          onClick={() => setSelectedConversation({
                            senderPhone: conversation.sender_phone,
                            sessionStart: conversation.first_message_at,
                            sessionEnd: conversation.last_message_at,
                            senderName: conversation.sender_name
                          })}
                        >
                          {hasJourneys && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedConversations(prev => {
                                  const newSet = new Set(prev);
                                  if (newSet.has(sessionKey)) {
                                    newSet.delete(sessionKey);
                                  } else {
                                    newSet.add(sessionKey);
                                  }
                                  return newSet;
                                });
                              }}
                              className="p-0.5 hover:bg-gray-200 rounded transition-colors shrink-0"
                            >
                              <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                          )}
                          {!hasJourneys && <div className="w-5" />}

                          <div className="relative shrink-0">
                            <div className="w-11 h-11 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center">
                              <span className="text-base font-semibold text-white">
                                {(conversation.sender_name || conversation.sender_phone)?.[0]?.toUpperCase() || 'A'}
                              </span>
                            </div>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <h3 className="font-semibold text-sm text-gray-900 truncate">
                                {conversation.sender_name || conversation.sender_phone}
                              </h3>
                              <span className={`text-[11px] shrink-0 ml-2 ${isToday ? 'text-emerald-600 font-medium' : 'text-gray-400'}`}>
                                {isToday ? format(parseUTCDate(conversation.last_message_at), "h:mm a") : sessionDate}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-gray-500 truncate">
                                {conversation.sender_name ? conversation.sender_phone : ''}
                              </p>
                              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                {hasJourneys && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-medium">
                                    {conversation.journeys.length} {conversation.journeys.length === 1 ? 'journey' : 'journeys'}
                                  </span>
                                )}
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-medium">
                                  {conversation.message_count}
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConversationToDelete(conversation);
                            }}
                            className="p-1 rounded-md hover:bg-red-100 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                            title="Delete conversation"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {hasJourneys && isExpanded && (() => {
                          const visibleCount = journeyVisibleCount[sessionKey] || 10;
                          const visibleJourneys = conversation.journeys.slice(0, visibleCount);
                          const hasMore = conversation.journeys.length > visibleCount;
                          return (
                          <div className="border-l-2 border-purple-200 ml-10 bg-gray-50/50">
                            {visibleJourneys.map((journey) => {
                              const journeyTime = format(parseUTCDate(journey.first_message_at), "MMM d, h:mm a");
                              const isJourneyActive = selectedConversation?.flowSessionId === journey.flow_session_id;
                              return (
                                <div
                                  key={journey.flow_session_id}
                                  className={`flex items-center gap-2.5 px-5 py-2.5 cursor-pointer transition-all duration-200 group ${isJourneyActive ? 'bg-purple-50' : 'hover:bg-purple-50/50'}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedConversation({
                                      senderPhone: conversation.sender_phone,
                                      sessionStart: journey.first_message_at,
                                      sessionEnd: journey.last_message_at,
                                      senderName: conversation.sender_name,
                                      flowSessionId: journey.flow_session_id,
                                      journeyName: journey.flow_name
                                    });
                                  }}
                                >
                                  <div className="w-7 h-7 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center shrink-0">
                                    <Sparkles className="h-3.5 w-3.5 text-white" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-purple-800 text-xs truncate">
                                        {journey.flow_name}
                                      </span>
                                      <span className="text-[10px] text-gray-400 shrink-0">
                                        {journeyTime}
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-gray-500">
                                      {journey.message_count} {journey.message_count === 1 ? 'message' : 'messages'}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                            {hasMore && (
                              <button
                                className="w-full py-2 text-xs text-purple-600 hover:text-purple-800 hover:bg-purple-50 transition-colors font-medium"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setJourneyVisibleCount(prev => ({
                                    ...prev,
                                    [sessionKey]: visibleCount + 10
                                  }));
                                }}
                              >
                                View more ({conversation.journeys.length - visibleCount} remaining)
                              </button>
                            )}
                          </div>
                          );
                        })()}
                      </div>
                    );
                  })
                )}
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-emerald-500 mr-2" />
                    <span className="text-gray-500 text-xs">Loading more...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel - Chat View */}
            <div className={`${selectedConversation ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0`}>
              {selectedConversation ? (
                <>
                  <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-3 shrink-0">
                    <div className="flex items-center gap-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedConversation(null)}
                        className="text-white hover:bg-white/20 rounded-full md:hidden"
                      >
                        <ArrowLeft className="h-5 w-5" />
                      </Button>
                      <div className={`w-10 h-10 ${selectedConversation.journeyName ? 'bg-purple-400/40' : 'bg-white/20'} backdrop-blur rounded-full flex items-center justify-center shrink-0`}>
                        {selectedConversation.journeyName ? (
                          <Sparkles className="h-5 w-5 text-white" />
                        ) : (
                          <span className="text-lg font-semibold text-white">
                            {(selectedConversation.senderName || selectedConversation.senderPhone)?.[0]?.toUpperCase() || 'A'}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {selectedConversation.journeyName ? (
                          <>
                            <h2 className="text-base font-semibold text-white truncate">
                              {selectedConversation.journeyName}
                            </h2>
                            <p className="text-emerald-100 text-xs truncate">
                              {selectedConversation.senderName || selectedConversation.senderPhone}
                            </p>
                          </>
                        ) : (
                          <>
                            <h2 className="text-base font-semibold text-white truncate">
                              {selectedConversation.senderName || selectedConversation.senderPhone}
                            </h2>
                            <p className="text-emerald-100 text-xs truncate">
                              {selectedConversation.senderName && selectedConversation.senderPhone}
                            </p>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => refetchMessages()}
                          disabled={messagesRefetching}
                          className="text-white hover:bg-white/20 rounded-full h-8 w-8"
                          title="Refresh messages"
                        >
                          <RefreshCw className={`h-4 w-4 ${messagesRefetching ? 'animate-spin' : ''}`} />
                        </Button>
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/20 backdrop-blur text-white text-[11px] font-medium">
                          <MessageCircle className="h-3 w-3" />
                          {format(parseUTCDate(selectedConversation.sessionStart), "MMM d, yyyy")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div ref={messagesContainerRef} className="bg-[#f0f2f5] flex-1 overflow-y-auto" style={{ fontFamily: "'Poppins', sans-serif" }}>
                    {messagesLoading ? (
                      <div className="flex items-center justify-center h-64">
                        <div className="text-center">
                          <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mx-auto mb-2" />
                          <p className="text-gray-500 text-sm">Loading messages...</p>
                        </div>
                      </div>
                    ) : !allMessages.length ? (
                      <div className="flex items-center justify-center h-64">
                        <div className="text-center">
                          <MessageCircle className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                          <p className="text-gray-500">No messages in this session</p>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 space-y-1">
                        {loadingOlderMessages && (
                          <div className="flex items-center justify-center py-3">
                            <Loader2 className="h-5 w-5 animate-spin text-emerald-500 mr-2" />
                            <span className="text-gray-500 text-sm">Loading older messages...</span>
                          </div>
                        )}
                        <div className="flex justify-center mb-4">
                          <span className="px-4 py-1.5 bg-white rounded-full text-xs font-medium text-gray-600 shadow-sm">
                            {format(parseUTCDate(allMessages[0]?.receivedAt || selectedConversation.sessionStart), "EEEE, MMMM d, yyyy")}
                          </span>
                        </div>

                        {allMessages.map((msg, index) => {
                          const isOutgoing = msg.direction === 'outgoing';
                          const prevMsg = allMessages[index - 1];
                          const showDateSeparator = prevMsg &&
                            format(parseUTCDate(msg.receivedAt), "yyyy-MM-dd") !==
                            format(parseUTCDate(prevMsg.receivedAt), "yyyy-MM-dd");

                          return (
                            <div key={msg.id}>
                              {showDateSeparator && (
                                <div className="flex justify-center my-4">
                                  <span className="px-4 py-1.5 bg-white rounded-full text-xs font-medium text-gray-600 shadow-sm">
                                    {format(parseUTCDate(msg.receivedAt), "EEEE, MMMM d, yyyy")}
                                  </span>
                                </div>
                              )}
                              <div className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} mb-1`}>
                                <div
                                  className={`relative max-w-[75%] px-3 py-2 rounded-2xl shadow-sm ${
                                    isOutgoing
                                      ? 'text-gray-800 rounded-br-md'
                                      : 'bg-white text-gray-800 rounded-bl-md'
                                  }`}
                                  style={isOutgoing ? { background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 50%, #93c5fd 100%)' } : {}}
                                >
                                  {msg.attachments && msg.attachments.length > 0 && (
                                    <div className="space-y-2 mb-2">
                                      {msg.attachments.map((att) => (
                                        <div key={att.id}>
                                          {att.fileType === 'image' && att.filePath && (
                                            <a href={att.filePath} target="_blank" rel="noopener noreferrer">
                                              <img
                                                src={att.filePath}
                                                alt={att.caption || att.fileName || 'Image'}
                                                className="max-w-full max-h-48 rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                                              />
                                            </a>
                                          )}
                                          {att.fileType !== 'image' && att.filePath && (
                                            <a
                                              href={att.filePath}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className={`flex items-center gap-2 p-2.5 rounded-xl ${
                                                isOutgoing ? 'bg-blue-600/20' : 'bg-gray-100'
                                              }`}
                                            >
                                              <FileText className="h-5 w-5 text-blue-600" />
                                              <span className="text-sm underline text-blue-600">
                                                {att.fileName || 'Download file'}
                                              </span>
                                            </a>
                                          )}
                                          {att.caption && (
                                            <p className="text-xs mt-1 text-gray-500">
                                              {att.caption}
                                            </p>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {msg.rawMessage && (
                                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.rawMessage}</p>
                                  )}
                                  {!msg.rawMessage && (!msg.attachments || msg.attachments.length === 0) && !isOutgoing && (
                                    <p className="text-[15px] text-gray-400 italic">📎 Document uploaded</p>
                                  )}

                                  <div className={`flex items-center justify-end gap-1 mt-1 ${
                                    isOutgoing ? 'text-emerald-700' : 'text-gray-400'
                                  }`}>
                                    <span className="text-[11px]">
                                      {format(parseUTCDate(msg.receivedAt), "h:mm a")}
                                    </span>
                                    {isOutgoing && (
                                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </div>
                    )}
                  </div>

                  <div className="bg-white border-t px-6 py-2 shrink-0">
                    <p className="text-center text-xs text-gray-400">
                      This is a view-only conversation history
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center bg-[#f0f2f5]">
                  <div className="text-center">
                    <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                      <MessagesSquare className="h-12 w-12 text-emerald-300" />
                    </div>
                    <h3 className="text-xl font-semibold text-gray-700 mb-2">WhatsApp Conversations</h3>
                    <p className="text-gray-500 text-sm max-w-xs">Select a conversation from the list to view the message history</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {currentPage === "leads" && (
          <Card className="shadow-lg border-0 rounded-xl overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-4 bg-gradient-to-r from-slate-50 to-white border-b">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-xl font-semibold tracking-tight">WhatsApp Leads</CardTitle>
                  {leadsFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />
                  ) : leadsData?.total !== undefined && (
                    <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 border-0">
                      {leadsData.total} {leadsData.total === 1 ? 'lead' : 'leads'}
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-sm text-muted-foreground">
                  Leads captured from WhatsApp messages with AI-extracted information
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {customCrmEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    disabled={generateTestLeadMutation.isPending}
                    onClick={() => generateTestLeadMutation.mutate()}
                  >
                    {generateTestLeadMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                    {generateTestLeadMutation.isPending ? "Creating..." : "Generate Test Lead"}
                  </Button>
                )}
                {customCrmEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    disabled={bulkSyncing}
                    onClick={() => setShowBulkSyncConfirm(true)}
                  >
                    {bulkSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {bulkSyncing ? "Syncing..." : "Sync All to CRM"}
                  </Button>
                )}
                <div className="flex items-center border rounded-lg p-0.5 bg-slate-100">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={leadsViewMode === "summary" ? "secondary" : "ghost"}
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setLeadsViewMode("summary")}
                        >
                          <LayoutList className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Summary view</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={leadsViewMode === "full" ? "secondary" : "ghost"}
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setLeadsViewMode("full")}
                        >
                          <Sheet className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>Full data view</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="rounded-full h-9 w-9 border-slate-200 hover:bg-slate-100 transition-colors"
                        onClick={() => setLocation("/admin/whatsapp-lead-capture-settings")}
                      >
                        <Settings className="h-4 w-4 text-slate-500" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Lead Capture Settings</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {/* Search and date filter bar */}
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b bg-slate-50">
                <div className="relative mr-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    placeholder="Search leads..."
                    value={leadsSearchInput}
                    onChange={(e) => setLeadsSearchInput(e.target.value)}
                    className="h-7 w-48 pl-8 text-xs rounded-full border-slate-200 focus-visible:ring-1 focus-visible:ring-emerald-500"
                  />
                </div>
                {(["all", "today", "yesterday", "last7", "last30"] as const).map((preset) => (
                  <Button
                    key={preset}
                    variant={leadsDateFilter === preset ? "default" : "outline"}
                    size="sm"
                    className={`text-xs h-7 rounded-full px-3 ${leadsDateFilter === preset ? "bg-emerald-600 hover:bg-emerald-700 text-white border-0" : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}
                    onClick={() => { setLeadsDateFilter(preset); setLeadsPage(1); }}
                  >
                    {preset === "all" ? "All time" : preset === "today" ? "Today" : preset === "yesterday" ? "Yesterday" : preset === "last7" ? "Last 7 days" : "Last 30 days"}
                  </Button>
                ))}
                <Popover open={customPickerOpen} onOpenChange={setCustomPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant={leadsDateFilter === "custom" ? "default" : "outline"}
                      size="sm"
                      className={`text-xs h-7 rounded-full px-3 gap-1.5 ${leadsDateFilter === "custom" ? "bg-emerald-600 hover:bg-emerald-700 text-white border-0" : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}
                    >
                      <CalendarIcon className="h-3 w-3" />
                      {leadsDateFilter === "custom" && leadsCustomFrom
                        ? leadsCustomTo
                          ? `${format(leadsCustomFrom, "MMM d")} – ${format(leadsCustomTo, "MMM d, yyyy")}`
                          : format(leadsCustomFrom, "MMM d, yyyy")
                        : "Custom range"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-3" align="start">
                    <p className="text-xs text-slate-500 mb-2 font-medium">Select start date</p>
                    <Calendar
                      mode="range"
                      selected={{ from: leadsCustomFrom, to: leadsCustomTo }}
                      onSelect={(range) => {
                        setLeadsCustomFrom(range?.from);
                        setLeadsCustomTo(range?.to);
                        if (range?.from) {
                          setLeadsDateFilter("custom");
                          setLeadsPage(1);
                          if (range.to) setCustomPickerOpen(false);
                        }
                      }}
                      disabled={{ after: new Date() }}
                      initialFocus
                    />
                    {leadsDateFilter === "custom" && leadsCustomFrom && (
                      <div className="flex justify-end mt-2">
                        <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => {
                          setLeadsDateFilter("all");
                          setLeadsCustomFrom(undefined);
                          setLeadsCustomTo(undefined);
                          setCustomPickerOpen(false);
                          setLeadsPage(1);
                        }}>
                          <X className="h-3 w-3 mr-1" /> Clear
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>

              {leadsLoading ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mb-3" />
                  <p className="text-sm text-muted-foreground">Loading leads...</p>
                </div>
              ) : !leadsData?.leads.length ? (
                <div className="flex flex-col items-center justify-center py-20 px-4">
                  <div className="rounded-full bg-slate-100 p-5 mb-5">
                    <Inbox className="h-10 w-10 text-slate-400" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-700 mb-1">No leads yet</h3>
                  <p className="text-sm text-muted-foreground text-center max-w-sm">
                    When customers send messages via WhatsApp, their information will be captured and displayed here.
                  </p>
                </div>
              ) : (
                <div className={`transition-opacity duration-150 ${leadsFetching ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/80 hover:bg-slate-50/80 border-b">
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 pl-6 whitespace-nowrap">Last Activity</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 whitespace-nowrap">Sender</TableHead>
                          {leadsViewMode === "summary"
                            ? displayedLeadFields.map((field: LeadField) => (
                                <TableHead key={field.id} className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 whitespace-nowrap">
                                  {field.fieldLabel} <span className="text-[10px] font-normal normal-case tracking-normal text-slate-400">(AI Extracted)</span>
                                </TableHead>
                              ))
                            : fullDataColumns.length > 0
                              ? fullDataColumns.map(col => (
                                  <TableHead key={col} className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 whitespace-nowrap min-w-[130px]">
                                    {formatColLabel(col)}
                                  </TableHead>
                                ))
                              : (
                                  <TableHead className="text-xs text-slate-400 py-3 italic font-normal normal-case">
                                    No flow data captured yet
                                  </TableHead>
                                )
                          }
                          {customCrmEnabled && (
                            <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 text-center whitespace-nowrap">CRM Sync</TableHead>
                          )}
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500 py-3 pr-6 text-right whitespace-nowrap">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leadsData.leads.map((lead) => (
                          <TableRow
                            key={lead.id}
                            className="cursor-pointer group hover:bg-slate-50/60 transition-colors border-b last:border-0"
                            onClick={() => handleViewLead(lead)}
                          >
                            <TableCell className="py-4 pl-6">
                              <div className="flex items-center gap-3">
                                <div>
                                  <div className="text-sm font-medium text-slate-700 whitespace-nowrap">
                                    {format(parseUTCDate((lead as any).lastMessageAt || lead.receivedAt), "h:mm a")}
                                  </div>
                                  <div className="text-xs text-slate-400 whitespace-nowrap">
                                    {format(parseUTCDate((lead as any).lastMessageAt || lead.receivedAt), "MMM d, yyyy")}
                                  </div>
                                </div>
                                {((lead as any).conversationCount || 1) > 1 && (
                                  <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-slate-100 rounded-full">
                                    <MessageCircle className="h-3 w-3 text-slate-500" />
                                    <span className="text-[11px] font-medium text-slate-600">{(lead as any).conversationCount}</span>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="py-4">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-800 truncate">
                                  {lead.senderPhone || "—"}
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5 truncate">
                                  {lead.senderName || "Unknown"}
                                </div>
                              </div>
                            </TableCell>
                            {leadsViewMode === "summary"
                              ? displayedLeadFields.map((field: LeadField) => {
                                  const value = getLeadFieldValue(lead, field.fieldKey);
                                  return (
                                    <TableCell key={field.id} className="py-4">
                                      <div className="text-sm text-slate-700 truncate max-w-[200px]">
                                        {value || <span className="text-slate-400 italic">—</span>}
                                      </div>
                                    </TableCell>
                                  );
                                })
                              : fullDataColumns.map(col => {
                                  const ed = (lead.extractedData as Record<string, any>) || {};
                                  const value = ed[col];
                                  return (
                                    <TableCell key={col} className="py-4 min-w-[130px]">
                                      <div className="text-sm text-slate-700 truncate max-w-[200px]">
                                        {value != null && value !== ''
                                          ? String(value)
                                          : <span className="text-slate-400 italic">—</span>
                                        }
                                      </div>
                                    </TableCell>
                                  );
                                })
                            }
                            {customCrmEnabled && (
                              <TableCell className="py-4 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {(lead as any).customCrmSyncStatus === 'synced' ? (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <CheckCircle className="h-4 w-4 text-green-500" />
                                        </TooltipTrigger>
                                        <TooltipContent><p>Synced to CRM</p></TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : (lead as any).customCrmSyncStatus === 'failed' ? (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger>
                                          <XCircle className="h-4 w-4 text-red-500 cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent><p>{friendlySyncError((lead as any).customCrmSyncError)}</p></TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : syncWhatsappLeadMutation.isPending && syncWhatsappLeadMutation.variables === lead.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                  ) : (
                                    <span className="text-slate-300 text-xs">—</span>
                                  )}
                                  {(!(lead as any).customCrmSyncStatus || (lead as any).customCrmSyncStatus === 'failed') && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 rounded-full hover:bg-blue-50"
                                      disabled={syncWhatsappLeadMutation.isPending}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        syncWhatsappLeadMutation.mutate(lead.id);
                                      }}
                                    >
                                      <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                            <TableCell className="py-4 pr-6">
                              <div className="flex items-center justify-end gap-1">
                                {hasDocuments(lead) && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 rounded-full hover:bg-blue-50"
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            setDocumentsDialogLead(lead);
                                            try {
                                              const resp = await fetch(`/api/whatsapp/leads/${lead.id}`, { credentials: "include" });
                                              if (resp.ok) {
                                                const data = await resp.json();
                                                setDocumentsDialogAttachments(data.attachments || []);
                                              }
                                            } catch { setDocumentsDialogAttachments([]); }
                                          }}
                                        >
                                          <FileText className="h-4 w-4 text-blue-500" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent><p>View Documents</p></TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
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
                </div>
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
                  onClick={() => setLocation("/admin/whatsapp-leads")}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <CardTitle>WA Lead Capture Settings</CardTitle>
                  <CardDescription>
                    Configure which fields to extract from incoming WhatsApp messages. Enable or disable fields, and add custom fields for your business needs.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">Enable Lead Capture</Label>
                  <p className="text-sm text-gray-500">
                    Automatically create leads from extracted message data
                  </p>
                </div>
                <Switch
                  checked={leadCaptureEnabled}
                  onCheckedChange={(checked) => {
                    setLeadCaptureEnabled(checked);
                    updateSettingsMutation.mutate({ leadCaptureEnabled: checked });
                  }}
                />
              </div>

              {leadCaptureEnabled && (
                <div className="space-y-4">
                  <div className="p-4 border rounded-lg space-y-3">
                    <div className="space-y-0.5">
                      <Label className="text-base">Lead Generation Mode</Label>
                      <p className="text-sm text-gray-500">
                        Choose when leads are created from incoming WhatsApp messages
                      </p>
                    </div>
                    <RadioGroup
                      value={leadGenerationMode}
                      onValueChange={(value) => {
                        setLeadGenerationMode(value);
                        updateSettingsMutation.mutate({ leadGenerationMode: value } as any);
                      }}
                      className="space-y-3 mt-2"
                    >
                      <div className="flex items-start space-x-3 p-3 rounded-md border hover:bg-gray-50 cursor-pointer">
                        <RadioGroupItem value="first_message" id="mode-first-message" className="mt-0.5" />
                        <div className="space-y-1">
                          <Label htmlFor="mode-first-message" className="cursor-pointer font-medium">On first message</Label>
                          <p className="text-sm text-gray-500">
                            A lead is created when someone messages your WhatsApp number. Messages from the same number are merged into one lead.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start space-x-3 p-3 rounded-md border hover:bg-gray-50 cursor-pointer">
                        <RadioGroupItem value="flow_only" id="mode-flow-only" className="mt-0.5" />
                        <div className="space-y-1">
                          <Label htmlFor="mode-flow-only" className="cursor-pointer font-medium">On lead capture flow</Label>
                          <p className="text-sm text-gray-500">
                            Leads are only created when someone completes a flow journey. Each flow session creates a separate lead — ideal when one phone is used for multiple customers (e.g., a salesman).
                          </p>
                        </div>
                      </div>
                    </RadioGroup>
                  </div>

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
                              {field.defaultCrmFieldKey && (
                                <p className="text-xs text-blue-600">CRM key: <span className="font-mono">{field.defaultCrmFieldKey}</span></p>
                              )}
                              {field.allowedValues && field.allowedValues.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {field.allowedValues.map((v) => (
                                    <span key={v} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-700 border border-violet-200">{v}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-gray-400 hover:text-gray-600"
                              title="Edit field settings"
                              onClick={() => {
                                setEditCrmKeyFieldId(field.id);
                                setEditCrmKeyValue(field.defaultCrmFieldKey ?? "");
                                setEditAllowedValues(field.allowedValues ?? []);
                                setEditAllowedInput("");
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {!field.isDefault && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
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
                Create a new field to extract from WhatsApp messages. The AI will attempt to find this information in incoming messages.
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
                <select
                  className="w-full p-2 border rounded-md"
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value)}
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="currency">Currency (₹)</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Default CRM Field Key <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  placeholder="e.g., CompanyName, MonthlyIncome, CourseId"
                  value={newFieldCrmKey}
                  onChange={(e) => setNewFieldCrmKey(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The field name your CRM API expects. Used to auto-create CRM field mappings.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Allowed Values <span className="text-muted-foreground font-normal">(optional)</span></Label>
                {newFieldAllowedValues.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {newFieldAllowedValues.map((v) => (
                      <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-700 border border-violet-200">
                        {v}
                        <button
                          type="button"
                          className="hover:text-violet-900 ml-0.5"
                          onClick={() => setNewFieldAllowedValues(newFieldAllowedValues.filter((x) => x !== v))}
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}
                <Input
                  placeholder="Type a value and press Enter or comma to add"
                  value={newFieldAllowedInput}
                  onChange={(e) => setNewFieldAllowedInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ',') && newFieldAllowedInput.trim()) {
                      e.preventDefault();
                      const val = newFieldAllowedInput.trim().replace(/,$/, '');
                      if (val && !newFieldAllowedValues.includes(val)) setNewFieldAllowedValues([...newFieldAllowedValues, val]);
                      setNewFieldAllowedInput("");
                    } else if (e.key === 'Backspace' && !newFieldAllowedInput && newFieldAllowedValues.length > 0) {
                      setNewFieldAllowedValues(newFieldAllowedValues.slice(0, -1));
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">When set, the AI will only pick values from this list. Leave empty to allow any value.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowAddFieldDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (newFieldLabel.trim()) {
                    const finalAllowed = newFieldAllowedInput.trim()
                      ? [...newFieldAllowedValues, newFieldAllowedInput.trim()].filter((v, i, arr) => arr.indexOf(v) === i)
                      : newFieldAllowedValues;
                    createFieldMutation.mutate({
                      fieldKey: newFieldLabel.toLowerCase().replace(/\s+/g, "_"),
                      fieldLabel: newFieldLabel.trim(),
                      fieldType: newFieldType,
                      defaultCrmFieldKey: newFieldCrmKey.trim() || undefined,
                      allowedValues: finalAllowed.length > 0 ? finalAllowed : undefined,
                    });
                  }
                }}
                disabled={!newFieldLabel.trim() || createFieldMutation.isPending}
              >
                {createFieldMutation.isPending ? "Adding..." : "Add Field"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editCrmKeyFieldId} onOpenChange={(open) => { if (!open) { setEditCrmKeyFieldId(null); setEditAllowedInput(""); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Field Settings</DialogTitle>
              <DialogDescription>
                Configure the CRM key and optionally restrict what values the AI can extract for this field.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Default CRM Field Key</Label>
                <Input
                  placeholder="e.g., Name, Mobile, CompanyName"
                  value={editCrmKeyValue}
                  onChange={(e) => setEditCrmKeyValue(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Leave empty to remove the CRM key from this field.</p>
              </div>
              <div className="space-y-2">
                <Label>Allowed Values <span className="text-muted-foreground font-normal">(optional)</span></Label>
                {editAllowedValues.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {editAllowedValues.map((v) => (
                      <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-700 border border-violet-200">
                        {v}
                        <button
                          type="button"
                          className="hover:text-violet-900 ml-0.5"
                          onClick={() => setEditAllowedValues(editAllowedValues.filter((x) => x !== v))}
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}
                <Input
                  placeholder="Type a value and press Enter or comma to add"
                  value={editAllowedInput}
                  onChange={(e) => setEditAllowedInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ',') && editAllowedInput.trim()) {
                      e.preventDefault();
                      const val = editAllowedInput.trim().replace(/,$/, '');
                      if (val && !editAllowedValues.includes(val)) setEditAllowedValues([...editAllowedValues, val]);
                      setEditAllowedInput("");
                    } else if (e.key === 'Backspace' && !editAllowedInput && editAllowedValues.length > 0) {
                      setEditAllowedValues(editAllowedValues.slice(0, -1));
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">When set, the AI will only extract values from this list. Leave empty to allow any value.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => { setEditCrmKeyFieldId(null); setEditAllowedInput(""); }}>Cancel</Button>
              <Button
                onClick={() => {
                  if (editCrmKeyFieldId) {
                    const finalAllowed = editAllowedInput.trim()
                      ? [...editAllowedValues, editAllowedInput.trim()].filter((v, i, arr) => arr.indexOf(v) === i)
                      : editAllowedValues;
                    updateFieldMutation.mutate({
                      fieldId: editCrmKeyFieldId,
                      defaultCrmFieldKey: editCrmKeyValue.trim() || null,
                      allowedValues: finalAllowed.length > 0 ? finalAllowed : null,
                    });
                    setEditCrmKeyFieldId(null);
                    setEditAllowedInput("");
                  }
                }}
                disabled={updateFieldMutation.isPending}
              >
                {updateFieldMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={leadDetailOpen} onOpenChange={setLeadDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[70vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-green-600" />
              Lead Details
            </DialogTitle>
            <DialogDescription asChild>
              <span className="block">
                {selectedLead && (
                  <span className="flex items-center gap-4">
                    <span>{format(parseUTCDate(selectedLead.receivedAt), "MMMM d, yyyy 'at' h:mm a")}</span>
                    <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">
                      ID: {selectedLead.id.slice(0, 8)}
                    </span>
                  </span>
                )}
              </span>
            </DialogDescription>
          </DialogHeader>

          {leadDetailData?.lead && (() => {
            const lead = leadDetailData.lead;
            const ed = (lead.extractedData as Record<string, any>) || {};
            const allFields: Record<string, string> = {};
            const coreFields = new Set(['customer_name', 'customer_phone', 'phone', 'customer_email', 'notes', 'bank_statement_password']);
            Object.entries(ed).forEach(([key, value]) => {
              if (!coreFields.has(key) && !key.startsWith('_') && value !== null && value !== undefined && value !== '') {
                allFields[key] = String(value);
              }
            });

            const personalKeys = new Set(['pan', 'aadhaar', 'date_of_birth', 'dob', 'occupation', 'gender', 'father_name', 'mother_name', 'marital_status', 'nationality', 'religion']);
            const loanKeys = new Set(['loan_amount', 'loan_type', 'scheme_name', 'emi', 'tenure', 'interest_rate', 'loan_purpose', 'loan_status']);
            const bankKeys = new Set(['account_no', 'account_number', 'account_no.', 'ifsc_code', 'ifsc', 'bank_name', 'branch_name']);
            const addressKeys = new Set(['address', 'full_address', 'current_address', 'permanent_address', 'city', 'state', 'pincode', 'pin_code', 'district', 'landmark']);
            const businessKeys = new Set(['store_name', 'dealer_name', 'company_name', 'employer_name', 'business_name', 'designation', 'department', 'monthly_salary', 'annual_income', 'income']);

            const personalFields: [string, string][] = [];
            const loanFields: [string, string][] = [];
            const bankFields: [string, string][] = [];
            const addressFields: [string, string][] = [];
            const businessFields: [string, string][] = [];
            const otherFields: [string, string][] = [];

            Object.entries(allFields).forEach(([key, value]) => {
              const k = key.replace(/\.$/, '');
              if (personalKeys.has(k)) personalFields.push([key, value]);
              else if (loanKeys.has(k)) loanFields.push([key, value]);
              else if (bankKeys.has(k) || k.includes('account')) bankFields.push([key, value]);
              else if (addressKeys.has(k)) addressFields.push([key, value]);
              else if (businessKeys.has(k)) businessFields.push([key, value]);
              else otherFields.push([key, value]);
            });

            if (lead.customerName && !isFlowPlaceholder(lead.customerName)) personalFields.unshift(['customer_name', lead.customerName]);
            if (lead.customerPhone) personalFields.push(['phone', lead.customerPhone]);
            if (lead.customerEmail) personalFields.push(['email', lead.customerEmail]);

            const maskSensitiveValue = (key: string, value: string): string => {
              const k = key.toLowerCase().replace(/[._\s]/g, '');
              if (k === 'pan' || k === 'aadhaar' || k === 'aadhar') {
                return value.length > 4
                  ? 'X'.repeat(value.length - 4) + value.slice(-4)
                  : value;
              }
              return value;
            };

            const renderSection = (title: string, fields: [string, string][], bgColor: string) => {
              if (fields.length === 0) return null;
              return (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">{title}</Label>
                  <div className={`grid grid-cols-2 gap-3 p-3 ${bgColor} rounded-lg`}>
                    {fields.map(([key, value]) => (
                      <div key={key} className="space-y-0.5">
                        <span className="text-xs text-gray-500 capitalize">{key.replace(/_/g, ' ')}</span>
                        <p className="text-sm font-medium">{maskSensitiveValue(key, value)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            };

            const verification = (lead as any).verificationResults as
              | { verdict: string; ranAt?: string; ruleSetName?: string; counts?: { total: number; pass: number; fail: number; skipped: number }; findings?: { ruleName: string; status: "pass" | "fail" | "skipped"; severity: "info" | "warning" | "blocker"; message: string }[] }
              | null
              | undefined;

            const verdictClass: Record<string, string> = {
              "Eligible": "bg-emerald-100 text-emerald-800 border-emerald-200",
              "Conditionally Eligible": "bg-amber-100 text-amber-800 border-amber-200",
              "Discrepancy": "bg-red-100 text-red-800 border-red-200",
              "Pending": "bg-gray-100 text-gray-700 border-gray-200",
            };

            const statusIcon: Record<string, string> = { pass: "✅", fail: "❌", skipped: "⏳" };

            return (
              <div className="space-y-4 overflow-y-auto flex-1 pr-2">
                {renderSection("Personal Details", personalFields, "bg-slate-50")}
                {renderSection("Loan Details", loanFields, "bg-green-50")}
                {renderSection("Bank Details", bankFields, "bg-blue-50")}
                {renderSection("Address", addressFields, "bg-amber-50")}
                {renderSection("Business / Employment", businessFields, "bg-purple-50")}
                {renderSection("Other Details", otherFields, "bg-gray-50")}

                <div className="space-y-2 pt-2 border-t">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs text-gray-500 font-semibold uppercase tracking-wide flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Verification
                    </Label>
                    {verification?.verdict && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${verdictClass[verification.verdict] || "bg-gray-100 text-gray-700"}`}>
                        {verification.verdict}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 rounded-lg">
                    <select
                      value={selectedVerificationRuleSetId}
                      onChange={(e) => setSelectedVerificationRuleSetId(e.target.value)}
                      className="text-xs border rounded px-2 py-1 bg-white"
                      data-testid="select-verification-rule-set"
                    >
                      <option value="">Select rule set…</option>
                      {(verificationRuleSets?.ruleSets || []).map(rs => (
                        <option key={rs.id} value={rs.id}>{rs.name}{rs.isActive ? "" : " (inactive)"}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!selectedVerificationRuleSetId || runVerificationMutation.isPending}
                      onClick={() => runVerificationMutation.mutate({ leadId: lead.id, ruleSetId: selectedVerificationRuleSetId, notify: false })}
                      data-testid="button-run-verification"
                    >
                      {runVerificationMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                      Run
                    </Button>
                    <Button
                      size="sm"
                      disabled={!selectedVerificationRuleSetId || runVerificationMutation.isPending}
                      onClick={() => runVerificationMutation.mutate({ leadId: lead.id, ruleSetId: selectedVerificationRuleSetId, notify: true })}
                      data-testid="button-run-verification-notify"
                    >
                      Run &amp; notify customer
                    </Button>
                  </div>

                  {verification?.findings && verification.findings.length > 0 && (
                    <div className="text-xs text-gray-500">
                      {verification.ruleSetName && <span className="font-medium text-gray-700">{verification.ruleSetName}</span>}
                      {verification.counts && (
                        <span className="ml-2">
                          {verification.counts.pass}/{verification.counts.total} passed · {verification.counts.fail} failed · {verification.counts.skipped} pending
                        </span>
                      )}
                      <div className="mt-2 border rounded-lg divide-y bg-white">
                        {verification.findings.map((f, idx) => (
                          <div key={idx} className="px-3 py-2 flex items-start gap-2">
                            <span className="text-base leading-none mt-0.5">{statusIcon[f.status] || "•"}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-gray-800">{f.ruleName}</div>
                              <div className="text-xs text-gray-500">{f.message}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!verification && (
                    <p className="text-xs text-gray-400">
                      No verification run yet. Pick a rule set above and click <span className="font-medium">Run</span>.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* View Documents Dialog */}
      <Dialog open={!!documentsDialogLead} onOpenChange={(open) => { if (!open) { setDocumentsDialogLead(null); setDocumentsDialogAttachments([]); } }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Uploaded Documents
            </DialogTitle>
            {documentsDialogLead && (
              <p className="text-sm text-gray-500">
                {(documentsDialogLead.customerName && !isFlowPlaceholder(documentsDialogLead.customerName)) ? documentsDialogLead.customerName : documentsDialogLead.senderPhone}
              </p>
            )}
          </DialogHeader>
          {documentsDialogLead && (() => {
            const data = (documentsDialogLead.extractedData || {}) as Record<string, any>;
            const password = data.bank_statement_password as string | undefined;

            return (
              <div className="space-y-4">
                {documentsDialogAttachments.length === 0 && !password && (
                  <p className="text-sm text-gray-500 text-center py-4">No documents found.</p>
                )}

                {(() => {
                  const atts = documentsDialogAttachments;
                  const isBankDoc = (att: any) => {
                    const cap = (att.caption || '').toLowerCase();
                    return cap.includes('bank') || cap.includes('statement') || (att.fileType === 'document' && att.fileName?.toLowerCase().endsWith('.pdf'));
                  };
                  const grouped: Record<string, any[]> = {};
                  for (const att of atts) {
                    const category = att.documentCategory || att.caption || null;
                    const key = category ? category : '_extra';
                    if (!grouped[key]) grouped[key] = [];
                    grouped[key].push(att);
                  }

                  const categoryOrder = Object.keys(grouped).filter(k => k !== '_extra');
                  // Attachments without documentCategory (invalid/untagged) are not shown

                  const groupHasBankDoc = (catAtts: any[]) =>
                    catAtts.some(isBankDoc);

                  let passwordShownInGroup = false;

                  const renderAttachment = (att: any) => (
                    <div key={att.id} className="flex items-center justify-between p-3 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        {att.fileType === "image" ? (
                          <Image className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        ) : (
                          <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        )}
                        <span className="truncate text-gray-600">{att.fileName || "Attachment"}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0">
                          {att.fileSize ? `${(att.fileSize / 1024).toFixed(0)} KB` : ""}
                        </span>
                      </div>
                      {att.filePath && (
                        <a
                          href={att.filePath}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline flex-shrink-0 ml-2"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </a>
                      )}
                    </div>
                  );

                  return categoryOrder.length > 0 ? (
                    <div className="space-y-3">
                      {categoryOrder.map((catKey) => {
                        const catAtts = grouped[catKey];
                        const label = catKey === '_extra' ? 'Extra' : catKey.replace(/_/g, ' ');
                        const labelCapitalized = label.charAt(0).toUpperCase() + label.slice(1);
                        const showPasswordHere = password && !passwordShownInGroup && groupHasBankDoc(catAtts);
                        if (showPasswordHere) passwordShownInGroup = true;

                        return (
                          <div key={catKey} className="border rounded-lg overflow-hidden">
                            <div className="bg-gray-100 px-3 py-1.5">
                              <span className="font-medium text-sm capitalize">{labelCapitalized}</span>
                            </div>
                            {catAtts.map((att: any) => (
                              <div key={att.id}>
                                {renderAttachment(att)}
                              </div>
                            ))}
                            {showPasswordHere && (
                              <div className="px-3 pb-3 pt-0">
                                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                                  <span className="text-xs text-amber-700 font-medium">Password:</span>
                                  <code className="text-sm bg-amber-100 px-1.5 py-0.5 rounded font-mono select-all">{password}</code>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {password && !passwordShownInGroup && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-amber-700 font-medium">Bank Statement Password:</span>
                            <code className="text-sm bg-amber-100 px-1.5 py-0.5 rounded font-mono select-all">{password}</code>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null;
                })()}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Bulk CRM Sync Confirmation */}
      <AlertDialog open={showBulkSyncConfirm} onOpenChange={setShowBulkSyncConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sync All Leads to CRM</AlertDialogTitle>
            <AlertDialogDescription>
              This will sync all unsynced and previously failed WhatsApp leads to your CRM. This may take a while depending on the number of leads. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowBulkSyncConfirm(false);
                syncAllWhatsappLeadsMutation.mutate();
              }}
            >
              Sync All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Lead Confirmation */}
      <AlertDialog open={!!leadToDelete} onOpenChange={(open) => !open && setLeadToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this lead? This action cannot be undone.
              {leadToDelete && (
                <span className="block mt-2 p-2 bg-gray-50 rounded text-sm">
                  <span className="block"><strong>Customer:</strong> {(leadToDelete.customerName && !isFlowPlaceholder(leadToDelete.customerName)) ? leadToDelete.customerName : "Unknown"}</span>
                  <span className="block"><strong>From:</strong> {leadToDelete.senderPhone}</span>
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => leadToDelete && deleteLeadMutation.mutate(leadToDelete.id)}
            >
              {deleteLeadMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Conversation Confirmation */}
      <AlertDialog open={!!conversationToDelete} onOpenChange={(open) => !open && setConversationToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Session</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this conversation session? All messages, leads, and attachments from this session will be permanently removed.
              {conversationToDelete && (
                <span className="block mt-2 p-2 bg-gray-50 rounded text-sm">
                  <span className="block"><strong>Contact:</strong> {conversationToDelete.sender_name || conversationToDelete.sender_phone}</span>
                  <span className="block"><strong>Phone:</strong> {conversationToDelete.sender_phone}</span>
                  <span className="block"><strong>Messages:</strong> {conversationToDelete.message_count}</span>
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => conversationToDelete && deleteConversationMutation.mutate(conversationToDelete)}
            >
              {deleteConversationMutation.isPending ? "Deleting..." : "Delete Session"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface SortableStepItemProps {
  step: WhatsappFlowStep;
  index: number;
  onEdit: (step: WhatsappFlowStep) => void;
  onDelete: (step: WhatsappFlowStep) => void;
  onTogglePause: (step: WhatsappFlowStep) => void;
}

function SortableStepItem({ step, index, onEdit, onDelete, onTogglePause }: SortableStepItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : step.paused ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-3 p-3 rounded-lg w-full overflow-hidden ${step.paused ? 'bg-gray-100 border border-dashed border-gray-300' : 'bg-gray-50'}`}
    >
      <div className="flex-shrink-0">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-200 rounded"
        >
          <GripVertical className="h-4 w-4 text-gray-400" />
        </button>
      </div>
      <div className={`flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${step.paused ? 'bg-gray-200 text-gray-400' : 'bg-purple-100 text-purple-700'}`}>
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={step.paused ? 'opacity-50' : ''}>{step.type}</Badge>
          {step.paused && <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700">Paused</Badge>}
        </div>
        <p className={`text-sm break-words ${step.paused ? 'text-gray-400 line-through' : 'text-gray-600'}`}>{step.prompt}</p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onTogglePause(step)}
          title={step.paused ? "Resume step" : "Pause step"}
        >
          {step.paused ? <Play className="h-4 w-4 text-green-600" /> : <Pause className="h-4 w-4 text-amber-500" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onEdit(step)}>
          <Edit className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(step)}
        >
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      </div>
    </div>
  );
}

function WhitelistSection({ settingsData, updateSettingsMutation }: { settingsData: any; updateSettingsMutation: any }) {
  const { toast } = useToast();
  const [newPhone, setNewPhone] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  // Enabling this gate against an empty list blocks every inbound message, so it needs an
  // explicit acknowledgement rather than a one-click toggle. The server enforces the same
  // rule; this dialog is what makes the consequence visible before the user commits.
  const [confirmBlockAll, setConfirmBlockAll] = useState(false);

  const { data: whitelistData, isLoading } = useQuery({
    queryKey: ["/api/whatsapp/whitelist"],
    queryFn: async () => {
      return await apiRequest("GET", "/api/whatsapp/whitelist");
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: { phoneNumber: string; label?: string }) => {
      return await apiRequest("POST", "/api/whatsapp/whitelist", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/whitelist"] });
      setNewPhone("");
      setNewLabel("");
      toast({ title: "Number added to whitelist" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add", description: error.message, variant: "destructive" });
    },
  });

  const bulkAddMutation = useMutation({
    mutationFn: async (numbers: string[]) => {
      return await apiRequest("POST", "/api/whatsapp/whitelist/bulk", { numbers });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/whitelist"] });
      setBulkText("");
      setShowBulkAdd(false);
      toast({ title: `Added ${data.added} numbers`, description: data.skipped > 0 ? `${data.skipped} skipped (duplicates or invalid)` : undefined });
    },
    onError: () => {
      toast({ title: "Bulk add failed", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/whatsapp/whitelist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/whitelist"] });
      toast({ title: "Number removed from whitelist" });
    },
  });

  const whitelist = whitelistData?.whitelist || [];
  const isEnabled = settingsData?.settings?.whitelistEnabled === true;

  const handleAdd = () => {
    if (!newPhone.trim()) return;
    addMutation.mutate({ phoneNumber: newPhone.trim(), label: newLabel.trim() || undefined });
  };

  const handleBulkAdd = () => {
    const lines = bulkText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;
    bulkAddMutation.mutate(lines);
  };

  return (
    <div className="space-y-6">
      <Card className="border-teal-200 bg-teal-50/30">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-teal-600" />
                <h3 className="text-lg font-semibold">Number Whitelist</h3>
              </div>
              <p className="text-sm text-gray-600">
                When enabled, only whitelisted numbers will receive AI responses. All other messages will be silently ignored.
              </p>
            </div>
            <Switch
              checked={isEnabled}
              onCheckedChange={(checked) => {
                if (checked && whitelist.length === 0) {
                  setConfirmBlockAll(true);
                  return;
                }
                updateSettingsMutation.mutate({ whitelistEnabled: checked } as any);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmBlockAll} onOpenChange={setConfirmBlockAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This will block every incoming message</AlertDialogTitle>
            <AlertDialogDescription>
              Your allowed-numbers list is empty. If you turn this on now, every WhatsApp message
              sent to your business will be discarded — no leads will be captured, and the AI will
              not reply to anyone, including you. Nothing will appear to be wrong.
              <br />
              <br />
              Add at least one number first, or confirm you want everything blocked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() =>
                updateSettingsMutation.mutate({
                  whitelistEnabled: true,
                  confirmBlockAllInbound: true,
                } as any)
              }
            >
              Block all incoming messages
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isEnabled && whitelist.length === 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-800">
                  Every incoming WhatsApp message is being discarded right now
                </p>
                <p className="text-sm text-red-700 mt-1">
                  The allowed-numbers gate is on but the list is empty, so nothing gets through — no
                  leads, no AI replies, no record of who tried to reach you. Add a number below, or
                  switch the gate off.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Add Number</CardTitle>
              <CardDescription>Add a phone number to the whitelist (digits only, with country code)</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowBulkAdd(!showBulkAdd)}>
              {showBulkAdd ? "Single Add" : "Bulk Add"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!showBulkAdd ? (
            <div className="flex gap-3">
              <div className="flex-1">
                <Input
                  placeholder="e.g. 919810560800"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
              </div>
              <div className="w-48">
                <Input
                  placeholder="Label (optional)"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
              </div>
              <Button onClick={handleAdd} disabled={addMutation.isPending || !newPhone.trim()}>
                {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea
                placeholder="Paste phone numbers, one per line. Example:&#10;919810560800&#10;918867310986&#10;917890123456"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={6}
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {bulkText.split("\n").filter(l => l.trim()).length} numbers detected
                </p>
                <Button onClick={handleBulkAdd} disabled={bulkAddMutation.isPending || !bulkText.trim()}>
                  {bulkAddMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Add All
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Whitelisted Numbers</CardTitle>
              <CardDescription>Numbers that are allowed to interact with the WhatsApp AI agent</CardDescription>
            </div>
            <Badge variant="secondary">{whitelist.length} total</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : whitelist.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No numbers whitelisted yet</p>
              <p className="text-xs mt-1">Add numbers above to get started</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {whitelist.map((entry: any) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono">{entry.phoneNumber}</TableCell>
                    <TableCell>{entry.label || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(entry.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DocTypeMultiSelect({
  availableTypes,
  selected,
  onChange,
}: {
  availableTypes: { docType: string; label: string }[];
  selected: { docType: string; label: string; isMandatory: boolean }[];
  onChange: (val: { docType: string; label: string; isMandatory: boolean }[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unselected = availableTypes.filter(
    (t) => !selected.some((s) => s.docType === t.docType)
  );
  const filtered = unselected.filter((t) =>
    t.label.toLowerCase().includes(search.toLowerCase())
  );

  const addDoc = (doc: { docType: string; label: string }) => {
    onChange([...selected, { docType: doc.docType, label: doc.label, isMandatory: true }]);
    setSearch("");
  };

  const removeDoc = (docType: string) => {
    onChange(selected.filter((s) => s.docType !== docType));
  };

  const toggleMandatory = (docType: string) => {
    onChange(
      selected.map((s) =>
        s.docType === docType ? { ...s, isMandatory: !s.isMandatory } : s
      )
    );
  };

  return (
    <div className="space-y-2">
      <div className="relative" ref={dropdownRef}>
        <div
          className="flex items-center border rounded-lg px-3 py-2 cursor-pointer hover:border-purple-400 transition-colors"
          onClick={() => setOpen(!open)}
        >
          <Search className="h-4 w-4 text-gray-400 mr-2 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={selected.length > 0 ? "Add more documents..." : "Select document types..."}
            className="flex-1 outline-none text-sm bg-transparent"
            onClick={(e) => e.stopPropagation()}
          />
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>

        {open && (
          <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">
                {unselected.length === 0 ? "All document types selected" : "No matching document types"}
              </div>
            ) : (
              filtered.map((doc) => (
                <div
                  key={doc.docType}
                  className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-purple-50 transition-colors"
                  onClick={() => addDoc(doc)}
                >
                  <FileText className="h-4 w-4 text-gray-400" />
                  <span>{doc.label}</span>
                  <span className="text-xs text-gray-400 ml-auto">{doc.docType}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((doc) => (
            <div
              key={doc.docType}
              className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full border bg-white text-sm"
            >
              <span className="text-gray-700">{doc.label}</span>
              <button
                type="button"
                onClick={() => toggleMandatory(doc.docType)}
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  doc.isMandatory
                    ? "bg-red-100 text-red-700 hover:bg-red-200"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {doc.isMandatory ? "Mandatory" : "Optional"}
              </button>
              <button
                type="button"
                onClick={() => removeDoc(doc.docType)}
                className="p-0.5 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <p className="text-xs text-gray-500">
          {selected.filter((d) => d.isMandatory).length} mandatory, {selected.filter((d) => !d.isMandatory).length} optional document(s) selected
        </p>
      )}
    </div>
  );
}

function FlowBuilderSection() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedFlow, setSelectedFlow] = useState<WhatsappFlow | null>(null);
  const [showNewFlowDialog, setShowNewFlowDialog] = useState(false);
  const [showEditFlowDialog, setShowEditFlowDialog] = useState(false);
  const [showStepDialog, setShowStepDialog] = useState(false);
  const [editingStep, setEditingStep] = useState<WhatsappFlowStep | null>(null);
  const [editingFlow, setEditingFlow] = useState<WhatsappFlow | null>(null);
  const [newFlowName, setNewFlowName] = useState("");
  const [newFlowDescription, setNewFlowDescription] = useState("");
  const [newFlowTriggerKeyword, setNewFlowTriggerKeyword] = useState("");
  const [flowTriggerMode, setFlowTriggerMode] = useState<"auto" | "keyword">("auto");
  const [newFlowSessionTimeout, setNewFlowSessionTimeout] = useState("30");
  const [newFlowCompletionMessage, setNewFlowCompletionMessage] = useState("Thank you! Your information has been recorded.");
  const [newFlowRepeatMode, setNewFlowRepeatMode] = useState<"once" | "loop">("once");
  const [newFlowAdaptiveMode, setNewFlowAdaptiveMode] = useState(false);
  const [newFlowVerificationRuleSetId, setNewFlowVerificationRuleSetId] = useState<string>("__none__");

  const { data: verificationRuleSetsData } = useQuery<{ ruleSets: Array<{ id: string; name: string; isActive: boolean }> }>({
    queryKey: ["/api/verification/rule-sets"],
  });
  
  const [stepType, setStepType] = useState("text");
  const [stepPrompt, setStepPrompt] = useState("");
  const [stepButtons, setStepButtons] = useState<{ id: string; title: string; nextStep?: string }[]>([]);
  const [stepDropdownItems, setStepDropdownItems] = useState<{ id: string; title: string; value: string; nextStep?: string; followUpPrompt?: string }[]>([]);
  const [stepDefaultNext, setStepDefaultNext] = useState("");
  const [stepSaveToField, setStepSaveToField] = useState("");
  const [stepRequiredFields, setStepRequiredFields] = useState<{ fieldKey: string; fieldLabel: string; isRequired: boolean }[]>([]);
  const [stepDocumentTypes, setStepDocumentTypes] = useState<{ docType: string; label: string; isMandatory: boolean }[]>([]);
  const [stepDependsOnFields, setStepDependsOnFields] = useState<string[]>([]);
  const [stepConditionalMappings, setStepConditionalMappings] = useState<{ key: string; items: { id: string; title: string; value: string; followUpPrompt?: string }[] }[]>([]);
  const [stepFallbackItems, setStepFallbackItems] = useState<{ id: string; title: string; value: string; followUpPrompt?: string }[]>([]);
  const conditionalExcelInputRef = useRef<HTMLInputElement | null>(null);
  const [conditionalExcelPreview, setConditionalExcelPreview] = useState<{
    fileName: string;
    result: ParseExcelResult;
  } | null>(null);
  const [showDeleteFlowDialog, setShowDeleteFlowDialog] = useState(false);
  const [flowToDelete, setFlowToDelete] = useState<WhatsappFlow | null>(null);
  const [showDeleteStepDialog, setShowDeleteStepDialog] = useState(false);
  const [stepToDelete, setStepToDelete] = useState<WhatsappFlowStep | null>(null);

  const { data: flowsData, isLoading: flowsLoading, refetch: refetchFlows } = useQuery({
    queryKey: ["/api/whatsapp/flows"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/flows", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch flows");
      return res.json() as Promise<{ flows: WhatsappFlow[] }>;
    },
  });

  const { data: leadFieldsForFlow } = useQuery({
    queryKey: ["/api/whatsapp/lead-fields"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/lead-fields", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch lead fields");
      return res.json() as Promise<{ fields: LeadField[] }>;
    },
  });

  const { data: docTypesData } = useQuery({
    queryKey: ["/api/whatsapp/document-types"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/document-types", { credentials: "include" });
      if (!res.ok) return { documentTypes: [] };
      return res.json() as Promise<{ documentTypes: { id: string; key: string; name: string; isActive: boolean; extractionFields: { key: string; label: string; required: boolean }[] }[] }>;
    },
  });
  const configuredDocTypes = (docTypesData?.documentTypes || []).filter(dt => dt.isActive);

  const { data: stepsData, refetch: refetchSteps } = useQuery({
    queryKey: ["/api/whatsapp/flows", selectedFlow?.id, "steps"],
    queryFn: async () => {
      if (!selectedFlow) return { steps: [] };
      const res = await fetch(`/api/whatsapp/flows/${selectedFlow.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch steps");
      return res.json() as Promise<{ steps: WhatsappFlowStep[] }>;
    },
    enabled: !!selectedFlow,
  });

  const getParentStepOptions = (fieldName: string): { id: string; title: string }[] => {
    const parentStep = (stepsData?.steps || []).find(s => s.saveToField === fieldName);
    if (!parentStep) return [];
    const opts = parentStep.options as any;
    if (opts?.dropdownItems?.length) return opts.dropdownItems;
    if (opts?.buttons?.length) return opts.buttons;
    if (opts?.conditionalOptions && typeof opts.conditionalOptions === "object") {
      const seen = new Set<string>();
      const collected: { id: string; title: string }[] = [];
      for (const bucket of Object.values(opts.conditionalOptions)) {
        if (!Array.isArray(bucket)) continue;
        for (const item of bucket) {
          if (item && typeof item.title === "string" && !seen.has(item.title)) {
            seen.add(item.title);
            collected.push({ id: item.id ?? item.title, title: item.title });
          }
        }
      }
      return collected;
    }
    return [];
  };


  const createFlowMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/whatsapp/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newFlowName, description: newFlowDescription, completionMessage: newFlowCompletionMessage || null }),
      });
      if (!res.ok) throw new Error("Failed to create flow");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Flow created" });
      refetchFlows();
      setShowNewFlowDialog(false);
      setNewFlowName("");
      setNewFlowDescription("");
      setNewFlowTriggerKeyword("");
      setNewFlowSessionTimeout("30");
      setNewFlowCompletionMessage("Thank you! Your information has been recorded.");
    },
  });
  
  const openEditFlowDialog = (flow: WhatsappFlow) => {
    setEditingFlow(flow);
    setNewFlowName(flow.name);
    setNewFlowDescription(flow.description || "");
    setNewFlowTriggerKeyword(flow.triggerKeyword || "");
    setFlowTriggerMode(flow.triggerKeyword ? "keyword" : "auto");
    setNewFlowSessionTimeout(flow.sessionTimeout?.toString() || "30");
    setNewFlowCompletionMessage(flow.completionMessage || "Thank you! Your information has been recorded.");
    setNewFlowRepeatMode((flow.repeatMode as "once" | "loop") || "once");
    setNewFlowAdaptiveMode(flow.adaptiveMode === "true");
    setNewFlowVerificationRuleSetId((flow as any).verificationRuleSetId || "__none__");
    setShowEditFlowDialog(true);
  };
  
  const closeEditFlowDialog = () => {
    setShowEditFlowDialog(false);
    setEditingFlow(null);
    setNewFlowName("");
    setNewFlowDescription("");
    setNewFlowTriggerKeyword("");
    setFlowTriggerMode("auto");
    setNewFlowSessionTimeout("30");
    setNewFlowCompletionMessage("Thank you! Your information has been recorded.");
    setNewFlowRepeatMode("once");
    setNewFlowAdaptiveMode(false);
    setNewFlowVerificationRuleSetId("__none__");
  };

  const updateFlowMutation = useMutation({
    mutationFn: async ({ flowId, updates }: { flowId: string; updates: Partial<WhatsappFlow> }) => {
      const res = await fetch(`/api/whatsapp/flows/${flowId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update flow");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Flow updated" });
      refetchFlows();
    },
  });

  const deleteFlowMutation = useMutation({
    mutationFn: async (flowId: string) => {
      const res = await fetch(`/api/whatsapp/flows/${flowId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete flow");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Flow deleted" });
      refetchFlows();
      setSelectedFlow(null);
    },
  });

  const createStepMutation = useMutation({
    mutationFn: async (stepData: any) => {
      const res = await fetch(`/api/whatsapp/flows/${selectedFlow?.id}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(stepData),
      });
      if (!res.ok) throw new Error("Failed to create step");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Step created" });
      refetchSteps();
      resetStepForm();
      setShowStepDialog(false);
    },
  });

  const updateStepMutation = useMutation({
    mutationFn: async ({ stepId, updates }: { stepId: string; updates: any }) => {
      const res = await fetch(`/api/whatsapp/flows/${selectedFlow?.id}/steps/${stepId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update step");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Step updated" });
      refetchSteps();
      resetStepForm();
      setShowStepDialog(false);
      setEditingStep(null);
    },
  });

  const togglePauseMutation = useMutation({
    mutationFn: async (step: WhatsappFlowStep) => {
      const res = await fetch(`/api/whatsapp/flows/${selectedFlow?.id}/steps/${step.id}/toggle-pause`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to toggle step pause");
      return res.json();
    },
    onMutate: async (step: WhatsappFlowStep) => {
      const queryKey = ["/api/whatsapp/flows", selectedFlow?.id, "steps"];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old: any) => {
        if (!old?.steps) return old;
        return {
          ...old,
          steps: old.steps.map((s: WhatsappFlowStep) =>
            s.id === step.id ? { ...s, paused: !s.paused } : s
          ),
        };
      });
      return { previous };
    },
    onError: (_err, _step, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/whatsapp/flows", selectedFlow?.id, "steps"], context.previous);
      }
      toast({ title: "Error", description: "Failed to update step", variant: "destructive" });
    },
    onSuccess: (data, step) => {
      const isPaused = data.step?.paused;
      const queryKey = ["/api/whatsapp/flows", selectedFlow?.id, "steps"];
      if (data.step) {
        queryClient.setQueryData(queryKey, (old: any) => {
          if (!old?.steps) return old;
          return {
            ...old,
            steps: old.steps.map((s: WhatsappFlowStep) =>
              s.id === step.id ? { ...s, ...data.step } : s
            ),
          };
        });
      }
      toast({ title: isPaused ? "Step paused" : "Step resumed", description: isPaused ? "This step will be skipped during the flow" : "This step is now active again" });
    },
  });

  const deleteStepMutation = useMutation({
    mutationFn: async (stepId: string) => {
      const res = await fetch(`/api/whatsapp/flows/${selectedFlow?.id}/steps/${stepId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete step");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Step deleted" });
      refetchSteps();
    },
  });

  const reorderStepsMutation = useMutation({
    mutationFn: async (stepIds: string[]) => {
      const res = await fetch(`/api/whatsapp/flows/${selectedFlow?.id}/steps/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ stepIds }),
      });
      if (!res.ok) throw new Error("Failed to reorder steps");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Steps reordered" });
      refetchSteps();
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const steps = stepsData?.steps || [];
      const oldIndex = steps.findIndex((s) => s.id === active.id);
      const newIndex = steps.findIndex((s) => s.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(steps, oldIndex, newIndex);
        const stepIds = newOrder.map((s) => s.id);
        reorderStepsMutation.mutate(stepIds);
      }
    }
  };

  const resetStepForm = () => {
    setStepType("text");
    setStepPrompt("");
    setStepButtons([]);
    setStepDropdownItems([]);
    setStepDefaultNext("");
    setStepSaveToField("");
    setStepRequiredFields([]);
    setStepDocumentTypes([]);
    setStepDependsOnFields([]);
    setStepConditionalMappings([]);
    setStepFallbackItems([]);
  };

  const openStepDialog = (step?: WhatsappFlowStep) => {
    if (step) {
      setEditingStep(step);
      setStepType(step.type);
      setStepPrompt(step.prompt);
      const buttons = step.options?.buttons || [];
      const dropdownItems = step.options?.dropdownItems || [];
      const nextMapping = step.nextStepMapping || {};
      setStepButtons(buttons.map(btn => ({ ...btn, nextStep: nextMapping[btn.id] || "" })));
      setStepDropdownItems(dropdownItems.map(item => ({
        ...item,
        value: item.value || item.title,
        nextStep: nextMapping[item.id] || "",
        followUpPrompt: item.followUpPrompt || "",
      })));
      setStepDefaultNext(step.defaultNextStep || "");
      setStepSaveToField(step.saveToField || "");
      // Load selected fields from step options (with required flag)
      const selectedFields = step.options?.selectedFields || [];
      if (selectedFields.length > 0) {
        // Ensure all fields have labels (resolve from leadFieldsForFlow if missing)
        const resolvedFields = selectedFields.map(sf => {
          if (sf.fieldLabel) return sf;
          const leadField = leadFieldsForFlow?.fields.find((f: LeadField) => f.fieldKey === sf.fieldKey);
          return { ...sf, fieldLabel: leadField?.fieldLabel || sf.fieldKey };
        });
        setStepRequiredFields(resolvedFields);
      } else {
        // Fallback: load requiredFields as all required
        const requiredFields = step.options?.requiredFields || [];
        setStepRequiredFields(requiredFields.map((fieldKey: string) => {
          const leadField = leadFieldsForFlow?.fields.find((f: LeadField) => f.fieldKey === fieldKey);
          return { fieldKey, fieldLabel: leadField?.fieldLabel || fieldKey, isRequired: true };
        }));
      }
      // Load document types for upload steps
      const documentTypes = step.options?.documentTypes || [];
      setStepDocumentTypes(documentTypes);
      // Load conditional/dependent options
      const stepOpts = step.options as any;
      if (stepOpts?.conditionalOptions) {
        const fields = stepOpts.dependsOnFields || (stepOpts.dependsOnField ? [stepOpts.dependsOnField] : []);
        setStepDependsOnFields(fields);
        const mappings = Object.entries(stepOpts.conditionalOptions as Record<string, { id: string; title: string; value?: string; followUpPrompt?: string }[]>)
          .map(([key, items]) => ({ key, items: items.map(item => ({ ...item, value: item.value || item.title, followUpPrompt: item.followUpPrompt || "" })) }));
        setStepConditionalMappings(mappings);
        setStepFallbackItems((stepOpts.fallbackOptions || []).map((item: any) => ({ ...item, value: item.value || item.title, followUpPrompt: item.followUpPrompt || "" })));
      } else {
        setStepDependsOnFields([]);
        setStepConditionalMappings([]);
        setStepFallbackItems([]);
      }
    } else {
      resetStepForm();
      setEditingStep(null);
    }
    setShowStepDialog(true);
  };

  const generateStepKey = () => {
    if (editingStep) {
      return editingStep.stepKey;
    }
    const steps = stepsData?.steps || [];
    // Use simple sequential numbering based on current step count
    return String(steps.length + 1);
  };

  const getAvailableSteps = (excludeCurrentStep = false) => {
    const steps = stepsData?.steps || [];
    const currentStepKey = editingStep?.stepKey;
    const filteredSteps = excludeCurrentStep && currentStepKey 
      ? steps.filter(s => s.stepKey !== currentStepKey)
      : steps;
    const options = filteredSteps.map((s, idx) => ({ 
      value: s.stepKey, 
      label: `Step ${s.stepKey}` 
    }));
    options.push({ value: "end", label: "End Flow" });
    options.push({ value: "end_with_ai", label: "End & Hand Off to AI" });
    return options;
  };

  const handleSaveStep = () => {
    const stepKey = editingStep?.stepKey || generateStepKey();
    const nextStepMapping: Record<string, string> = {};
    stepButtons.forEach(btn => {
      if (btn.nextStep) {
        nextStepMapping[btn.id] = btn.nextStep;
      }
    });
    stepDropdownItems.forEach(item => {
      if (item.nextStep) {
        nextStepMapping[item.id] = item.nextStep;
      }
    });

    let options: any = null;
    if (stepType === "buttons" && stepButtons.length > 0) {
      options = { buttons: stepButtons.map(b => ({ id: b.id, title: b.title })) };
    } else if (stepType === "dropdown" && stepDependsOnFields.length > 0) {
      const conditionalOptions: Record<string, any[]> = {};
      stepConditionalMappings.forEach(({ key, items }) => {
        if (key.trim()) conditionalOptions[key.trim()] = items.filter(i => i.title.trim()).map(i => {
          const item: any = { id: i.id, title: i.title.trim(), value: (i.value?.trim() || i.title.trim()) };
          if (i.followUpPrompt?.trim()) item.followUpPrompt = i.followUpPrompt.trim();
          return item;
        });
      });
      const fallbackMapped = stepFallbackItems.filter(i => i.title.trim()).map(i => {
        const item: any = { id: i.id, title: i.title.trim(), value: (i.value?.trim() || i.title.trim()) };
        if (i.followUpPrompt?.trim()) item.followUpPrompt = i.followUpPrompt.trim();
        return item;
      });
      options = {
        dependsOnFields: stepDependsOnFields.filter(Boolean),
        conditionalOptions,
        ...(fallbackMapped.length > 0 ? { fallbackOptions: fallbackMapped } : {}),
      };
    } else if (stepType === "dropdown" && stepDropdownItems.length > 0) {
      options = {
        dropdownItems: stepDropdownItems.map(d => {
          const item: any = { id: d.id, title: d.title.trim(), value: (d.value?.trim() || d.title.trim()) };
          if (d.followUpPrompt?.trim()) item.followUpPrompt = d.followUpPrompt.trim();
          return item;
        }),
      };
    }
    
    // Add requiredFields for input/text steps that have selected fields
    if ((stepType === "input" || stepType === "text") && stepRequiredFields.length > 0) {
      const requiredFieldKeys = stepRequiredFields
        .filter(f => f.isRequired)
        .map(f => f.fieldKey);
      if (requiredFieldKeys.length > 0) {
        options = options || {};
        options.requiredFields = requiredFieldKeys;
      }
      // Also store all selected fields (for display purposes)
      const allSelectedFields = stepRequiredFields.map(f => f.fieldKey);
      if (allSelectedFields.length > 0) {
        options = options || {};
        options.selectedFields = stepRequiredFields;
      }
    }
    
    // Add documentTypes for upload steps
    if (stepType === "upload" && stepDocumentTypes.length > 0) {
      options = options || {};
      options.documentTypes = stepDocumentTypes;
    }

    const stepData = {
      stepKey,
      stepOrder: editingStep ? (stepsData?.steps?.findIndex(s => s.id === editingStep.id) || 0) : (stepsData?.steps?.length || 0),
      type: stepType,
      prompt: stepPrompt,
      options,
      nextStepMapping: Object.keys(nextStepMapping).length > 0 ? nextStepMapping : null,
      defaultNextStep: stepDefaultNext || null,
      saveToField: stepSaveToField || null,
    };

    if (editingStep) {
      updateStepMutation.mutate({ stepId: editingStep.id, updates: stepData });
    } else {
      createStepMutation.mutate(stepData);
    }
  };

  const addButton = () => {
    if (stepButtons.length < 3) {
      setStepButtons([...stepButtons, { id: `btn_${stepButtons.length + 1}`, title: "", nextStep: "" }]);
    }
  };

  const updateButton = (index: number, field: "id" | "title" | "nextStep", value: string) => {
    const updated = [...stepButtons];
    updated[index] = { ...updated[index], [field]: value };
    setStepButtons(updated);
  };

  const removeButton = (index: number) => {
    setStepButtons(stepButtons.filter((_, i) => i !== index));
  };

  const addDropdownItem = () => {
    setStepDropdownItems([...stepDropdownItems, { id: `item_${stepDropdownItems.length + 1}`, title: "", value: "", nextStep: "" }]);
  };

  const updateDropdownItem = (index: number, field: "id" | "title" | "value" | "nextStep" | "followUpPrompt", value: string) => {
    const updated = [...stepDropdownItems];
    updated[index] = { ...updated[index], [field]: value };
    setStepDropdownItems(updated);
  };

  const removeDropdownItem = (index: number) => {
    setStepDropdownItems(stepDropdownItems.filter((_, i) => i !== index));
  };

  const availableSteps = getAvailableSteps(true);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-purple-600" />
            <CardTitle>Conversation Flows</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setLocation("/admin/whatsapp-flow-settings")}>
              <Settings className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => setShowNewFlowDialog(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Flow
            </Button>
          </div>
        </div>
        <CardDescription>
          Create structured conversation flows with buttons and dropdown menus for guided lead capture
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {flowsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : flowsData?.flows?.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No flows created yet. Create your first conversation flow to guide WhatsApp interactions.
          </div>
        ) : (
          <div className="space-y-3">
            {flowsData?.flows?.map((flow) => (
              <div
                key={flow.id}
                className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                  selectedFlow?.id === flow.id ? "border-purple-500 bg-purple-50" : "hover:border-gray-300"
                }`}
                onClick={() => setSelectedFlow(selectedFlow?.id === flow.id ? null : flow)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${flow.isActive === "true" ? "bg-green-100" : "bg-gray-100"}`}>
                      {flow.isActive === "true" ? (
                        <Play className="h-4 w-4 text-green-600" />
                      ) : (
                        <Pause className="h-4 w-4 text-gray-400" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-medium">{flow.name}</h4>
                      {flow.description && <p className="text-sm text-gray-500">{flow.description}</p>}
                      {flow.adaptiveMode === "true" && (
                        <p className="text-xs text-purple-700 mt-1">Adaptive guided journey enabled</p>
                      )}
                      {!(flow as any).verificationRuleSetId && (
                        <p className="text-xs text-amber-600 mt-1" data-testid={`text-no-rules-${flow.id}`}>
                          ⚠ No verification rules attached — uploaded documents will not be cross-checked.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={flow.isActive === "true"}
                      onCheckedChange={(checked) =>
                        updateFlowMutation.mutate({
                          flowId: flow.id,
                          updates: { isActive: checked ? "true" : "false" },
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditFlowDialog(flow);
                      }}
                    >
                      <Edit className="h-4 w-4 text-gray-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFlowToDelete(flow);
                        setShowDeleteFlowDialog(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedFlow && (
          <div className="mt-6 pt-6 border-t">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold">Steps for: {selectedFlow.name}</h4>
              <Button size="sm" onClick={() => openStepDialog()}>
                <Plus className="h-4 w-4 mr-1" /> Add Step
              </Button>
            </div>
            
            {stepsData?.steps?.length === 0 ? (
              <p className="text-gray-500 text-sm">No steps yet. Add your first step to define the conversation flow.</p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={stepsData?.steps?.map((s) => s.id) || []}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {stepsData?.steps?.map((step, index) => (
                      <SortableStepItem
                        key={step.id}
                        step={step}
                        index={index}
                        onEdit={openStepDialog}
                        onDelete={(s) => {
                          setStepToDelete(s);
                          setShowDeleteStepDialog(true);
                        }}
                        onTogglePause={(s) => togglePauseMutation.mutate(s)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        )}
      </CardContent>


      <Dialog open={showNewFlowDialog} onOpenChange={setShowNewFlowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Flow</DialogTitle>
            <DialogDescription>Define a new conversation flow for WhatsApp</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Flow Name</Label>
              <Input
                value={newFlowName}
                onChange={(e) => setNewFlowName(e.target.value)}
                placeholder="e.g., Lead Capture Flow"
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea
                value={newFlowDescription}
                onChange={(e) => setNewFlowDescription(e.target.value)}
                placeholder="Describe what this flow does"
              />
            </div>
            <div>
              <Label>Completion Message</Label>
              <Input
                value={newFlowCompletionMessage}
                onChange={(e) => setNewFlowCompletionMessage(e.target.value)}
                placeholder="Thank you! Your information has been recorded."
              />
              <p className="text-xs text-muted-foreground mt-1">Message sent when the flow is completed</p>
            </div>
            <Button onClick={() => createFlowMutation.mutate()} disabled={!newFlowName}>
              Create Flow
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteFlowDialog} onOpenChange={setShowDeleteFlowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Flow</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{flowToDelete?.name}"? This action cannot be undone and will remove all steps associated with this flow.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setFlowToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (flowToDelete) {
                  deleteFlowMutation.mutate(flowToDelete.id);
                }
                setShowDeleteFlowDialog(false);
                setFlowToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteStepDialog} onOpenChange={setShowDeleteStepDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Step</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{stepToDelete?.stepKey}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setStepToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (stepToDelete) {
                  deleteStepMutation.mutate(stepToDelete.id);
                }
                setShowDeleteStepDialog(false);
                setStepToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showEditFlowDialog} onOpenChange={(open) => !open && closeEditFlowDialog()}>
        <DialogContent className="max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Flow Settings</DialogTitle>
            <DialogDescription>Configure how this flow is triggered and behaves</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto pr-2 flex-1">
            <div>
              <Label>Flow Name</Label>
              <Input
                value={newFlowName}
                onChange={(e) => setNewFlowName(e.target.value)}
                placeholder="e.g., Lead Capture Flow"
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea
                value={newFlowDescription}
                onChange={(e) => setNewFlowDescription(e.target.value)}
                placeholder="Describe what this flow does"
              />
            </div>
            <div>
              <Label className="mb-2 block">How should this flow start?</Label>
              <RadioGroup
                value={flowTriggerMode}
                onValueChange={(value: "auto" | "keyword") => {
                  setFlowTriggerMode(value);
                  if (value === "auto") {
                    setNewFlowTriggerKeyword("");
                  }
                }}
                className="space-y-2"
              >
                <div className={`flex items-start space-x-3 p-3 rounded-md border cursor-pointer transition-colors ${flowTriggerMode === "auto" ? "border-purple-500 bg-purple-50" : "hover:bg-gray-50"}`}>
                  <RadioGroupItem value="auto" id="trigger-auto" className="mt-0.5" />
                  <div className="space-y-0.5">
                    <Label htmlFor="trigger-auto" className="cursor-pointer font-medium">Start from scratch</Label>
                    <p className="text-xs text-muted-foreground">
                      Flow begins automatically when someone sends any message
                    </p>
                  </div>
                </div>
                <div className={`flex items-start space-x-3 p-3 rounded-md border cursor-pointer transition-colors ${flowTriggerMode === "keyword" ? "border-purple-500 bg-purple-50" : "hover:bg-gray-50"}`}>
                  <RadioGroupItem value="keyword" id="trigger-keyword" className="mt-0.5" />
                  <div className="space-y-0.5 flex-1">
                    <Label htmlFor="trigger-keyword" className="cursor-pointer font-medium">Start from keyword</Label>
                    <p className="text-xs text-muted-foreground">
                      Flow only starts when user sends a specific keyword
                    </p>
                    {flowTriggerMode === "keyword" && (
                      <Input
                        value={newFlowTriggerKeyword}
                        onChange={(e) => setNewFlowTriggerKeyword(e.target.value)}
                        placeholder="e.g., start, help, menu"
                        className="mt-2"
                      />
                    )}
                  </div>
                </div>
              </RadioGroup>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label>Session Timeout (minutes)</Label>
                <div className="group relative">
                  <Info className="h-4 w-4 text-gray-400 cursor-help" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50">
                    After this many minutes of inactivity, the flow resets. User can start fresh with their next message.
                  </div>
                </div>
              </div>
              <Input
                type="number"
                min="1"
                max="1440"
                value={newFlowSessionTimeout}
                onChange={(e) => setNewFlowSessionTimeout(e.target.value)}
                placeholder="30"
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-sm font-medium">Completion Message</label>
              </div>
              <Input
                value={newFlowCompletionMessage}
                onChange={(e) => setNewFlowCompletionMessage(e.target.value)}
                placeholder="Thank you! Your information has been recorded."
              />
              <p className="text-xs text-muted-foreground mt-1">Message sent when the flow is completed</p>
            </div>
            <div>
              <Label className="mb-2 block">After flow is completed</Label>
              <RadioGroup
                value={newFlowRepeatMode}
                onValueChange={(value: "once" | "loop") => setNewFlowRepeatMode(value)}
                className="space-y-2"
              >
                <div className={`flex items-start space-x-3 p-3 rounded-md border cursor-pointer transition-colors ${newFlowRepeatMode === "once" ? "border-purple-500 bg-purple-50" : "hover:bg-gray-50"}`}>
                  <RadioGroupItem value="once" id="repeat-once" className="mt-0.5" />
                  <div className="space-y-0.5">
                    <Label htmlFor="repeat-once" className="cursor-pointer font-medium">Run once</Label>
                    <p className="text-xs text-muted-foreground">
                      Flow runs only once per user. After completion, they interact with AI instead.
                    </p>
                  </div>
                </div>
                <div className={`flex items-start space-x-3 p-3 rounded-md border cursor-pointer transition-colors ${newFlowRepeatMode === "loop" ? "border-purple-500 bg-purple-50" : "hover:bg-gray-50"}`}>
                  <RadioGroupItem value="loop" id="repeat-loop" className="mt-0.5" />
                  <div className="space-y-0.5">
                    <Label htmlFor="repeat-loop" className="cursor-pointer font-medium">Loop (repeat)</Label>
                    <p className="text-xs text-muted-foreground">
                      Flow restarts from the beginning after completion. For keyword-triggered flows, the user must send the keyword again.
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>
            <div className="rounded-lg border border-purple-200 bg-purple-50/60 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="adaptive-flow-mode" className="cursor-pointer">Adaptive guided journey</Label>
                  <p className="text-xs text-muted-foreground">
                    Let customers type configured choices in their own words or upload configured documents before the upload step. Chroney keeps the existing validation and returns to the next missing step.
                  </p>
                </div>
                <Switch
                  id="adaptive-flow-mode"
                  checked={newFlowAdaptiveMode}
                  onCheckedChange={setNewFlowAdaptiveMode}
                />
              </div>
              <p className="mt-3 text-xs text-purple-800">
                When off, this flow remains strictly step-by-step.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label>Verification rule set</Label>
                <div className="group relative">
                  <Info className="h-4 w-4 text-gray-400 cursor-help" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50">
                    Cross-checks uploaded documents against rules you configure (e.g. name on PAN matches name on Aadhaar). Manage rules under Verification Rules.
                  </div>
                </div>
              </div>
              <Select value={newFlowVerificationRuleSetId} onValueChange={setNewFlowVerificationRuleSetId}>
                <SelectTrigger data-testid="select-flow-verification-rule-set">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None — no cross-document checks</SelectItem>
                  {(verificationRuleSetsData?.ruleSets || [])
                    .filter((rs) => rs.isActive)
                    .map((rs) => (
                      <SelectItem key={rs.id} value={rs.id}>{rs.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={() => {
                if (editingFlow) {
                  updateFlowMutation.mutate({
                    flowId: editingFlow.id,
                    updates: {
                      name: newFlowName,
                      description: newFlowDescription || null,
                      triggerKeyword: flowTriggerMode === "keyword" ? (newFlowTriggerKeyword || null) : null,
                      sessionTimeout: parseInt(newFlowSessionTimeout) || 30,
                      completionMessage: newFlowCompletionMessage || null,
                      repeatMode: newFlowRepeatMode,
                      adaptiveMode: newFlowAdaptiveMode ? "true" : "false",
                      verificationRuleSetId: newFlowVerificationRuleSetId === "__none__" ? null : newFlowVerificationRuleSetId,
                    } as Partial<WhatsappFlow>,
                  });
                  closeEditFlowDialog();
                }
              }} 
              disabled={!newFlowName}
            >
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showStepDialog} onOpenChange={setShowStepDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingStep ? "Edit Step" : "Add New Step"}</DialogTitle>
            <DialogDescription>
              {editingStep ? `Editing ${editingStep.stepKey}` : `This will be Step ${(stepsData?.steps?.length || 0) + 1}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 pr-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label>Message Type</Label>
                <div className="group relative">
                  <Info className="h-4 w-4 text-gray-400 cursor-help" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50">
                    Text: Simple message. Buttons: Up to 3 options. Dropdown: Up to 10 list items. Input: Wait for reply. End: Finish flow.
                  </div>
                </div>
              </div>
              <Select value={stepType} onValueChange={setStepType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text Message</SelectItem>
                  <SelectItem value="buttons">Buttons (max 3)</SelectItem>
                  <SelectItem value="dropdown">Dropdown (max 10)</SelectItem>
                  <SelectItem value="input">Wait for Input</SelectItem>
                  <SelectItem value="upload">Document Upload</SelectItem>
                  <SelectItem value="end">End Flow</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label>Message</Label>
                <div className="group relative">
                  <Info className="h-4 w-4 text-gray-400 cursor-help" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50">
                    The message that will be sent to the user at this step.
                  </div>
                </div>
              </div>
              <Textarea
                value={stepPrompt}
                onChange={(e) => setStepPrompt(e.target.value)}
                placeholder="Enter the message to send"
                rows={3}
              />
            </div>

            {(stepType === "buttons" || stepType === "dropdown" || stepType === "input") && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label>Save Response to Lead Field</Label>
                  <div className="group relative">
                    <Info className="h-4 w-4 text-gray-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50">
                      Optionally save the user's response as lead data in the selected field.
                    </div>
                  </div>
                </div>
                <Select value={stepSaveToField || "__none__"} onValueChange={(v) => setStepSaveToField(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="Don't save response" />
                  </SelectTrigger>
                  <SelectContent className="max-h-48 overflow-y-auto min-w-[280px]">
                    <SelectItem value="__none__">Don't save response</SelectItem>
                    {leadFieldsForFlow?.fields
                      .filter((f: LeadField) => f.isEnabled)
                      .map((field: LeadField) => (
                        <SelectItem key={field.id} value={field.fieldKey}>{field.fieldLabel}</SelectItem>
                      ))
                    }
                  </SelectContent>
                </Select>
              </div>
            )}

            {(stepType === "input" || stepType === "text") && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label>Collect Lead Fields</Label>
                  <div className="group relative">
                    <Info className="h-4 w-4 text-gray-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50">
                      Select fields to collect from the user. Required fields will be asked for until all are provided. The message will be appended with the field names.
                    </div>
                  </div>
                </div>
                
                <div className="border rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                  {leadFieldsForFlow?.fields
                    .filter((f: LeadField) => f.isEnabled)
                    .map((field: LeadField) => {
                      const isSelected = stepRequiredFields.some(rf => rf.fieldKey === field.fieldKey);
                      const isRequired = stepRequiredFields.find(rf => rf.fieldKey === field.fieldKey)?.isRequired ?? true;
                      
                      return (
                        <div key={field.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setStepRequiredFields([...stepRequiredFields, { fieldKey: field.fieldKey, fieldLabel: field.fieldLabel, isRequired: true }]);
                                } else {
                                  setStepRequiredFields(stepRequiredFields.filter(rf => rf.fieldKey !== field.fieldKey));
                                }
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                            />
                            <span className="text-sm font-medium">{field.fieldLabel}</span>
                          </div>
                          
                          {isSelected && (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setStepRequiredFields(stepRequiredFields.map(rf => 
                                    rf.fieldKey === field.fieldKey 
                                      ? { ...rf, isRequired: !rf.isRequired }
                                      : rf
                                  ));
                                }}
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  isRequired 
                                    ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                              >
                                {isRequired ? 'Required' : 'Optional'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  }
                  {(!leadFieldsForFlow?.fields || leadFieldsForFlow.fields.filter((f: LeadField) => f.isEnabled).length === 0) && (
                    <p className="text-sm text-gray-500 text-center py-2">No lead fields configured. Add them in Settings.</p>
                  )}
                </div>
                
                {stepRequiredFields.length > 0 && (
                  <p className="text-xs text-gray-500">
                    {stepRequiredFields.filter(f => f.isRequired).length} required, {stepRequiredFields.filter(f => !f.isRequired).length} optional field(s) selected
                  </p>
                )}
              </div>
            )}

            {stepType === "upload" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label>Required Documents</Label>
                  <div className="group relative">
                    <Info className="h-4 w-4 text-gray-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50">
                      Select which documents users need to upload. AI will identify the document type from uploaded images.
                    </div>
                  </div>
                </div>
                
                <DocTypeMultiSelect
                  availableTypes={configuredDocTypes.length > 0
                    ? configuredDocTypes.map(dt => ({ docType: dt.key, label: dt.name }))
                    : [
                        { docType: "aadhaar", label: "Aadhaar Card" },
                        { docType: "pan", label: "PAN Card" },
                        { docType: "bank_statement", label: "Bank Statement" },
                        { docType: "driving_license", label: "Driving License" },
                      ]
                  }
                  selected={stepDocumentTypes}
                  onChange={setStepDocumentTypes}
                />
              </div>
            )}

            {stepType === "buttons" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label>Buttons</Label>
                  <div className="group relative">
                    <Info className="h-4 w-4 text-gray-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50">
                      Add up to 3 buttons. Each button can lead to a different step, enabling branching conversations.
                    </div>
                  </div>
                </div>
                {stepButtons.map((btn, index) => (
                  <div key={index} className="p-3 bg-gray-50 rounded-lg space-y-2">
                    <div className="flex gap-2 items-center">
                      <Input
                        value={btn.title}
                        onChange={(e) => updateButton(index, "title", e.target.value)}
                        placeholder="Button text (e.g., Yes, No)"
                        className="flex-1"
                      />
                      <Button variant="ghost" size="icon" onClick={() => removeButton(index)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500 whitespace-nowrap">Go to:</span>
                      <Select 
                        value={btn.nextStep || "__auto__"} 
                        onValueChange={(v) => updateButton(index, "nextStep", v === "__auto__" ? "" : v)}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select next step" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__auto__">Next step in order</SelectItem>
                          {availableSteps.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
                {stepButtons.length < 3 && (
                  <Button variant="outline" size="sm" onClick={addButton}>
                    <Plus className="h-4 w-4 mr-1" /> Add Button
                  </Button>
                )}
              </div>
            )}

            {stepType === "dropdown" && (
              <div className="space-y-3">
                {/* Static dropdown items — hidden when dependent mode is on */}
                {stepDependsOnFields.length === 0 && (
                  <>
                    <div className="flex items-center gap-2">
                      <Label>Dropdown Items</Label>
                      <div className="group relative">
                        <Info className="h-4 w-4 text-gray-400 cursor-help" />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50">
                          Add up to 10 options. Each item can lead to a different step, enabling branching conversations.
                        </div>
                      </div>
                    </div>
                    {stepDropdownItems.map((item, index) => (
                      <div key={index} className="p-3 bg-gray-50 rounded-lg space-y-2">
                        <div className="flex gap-2 items-start">
                          <div className="flex-1 grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase tracking-wide text-gray-500">Label (shown to customer)</Label>
                              <Input
                                value={item.title}
                                onChange={(e) => updateDropdownItem(index, "title", e.target.value)}
                                placeholder="e.g. Schedule Appointment"
                                data-testid={`input-dropdown-label-${index}`}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase tracking-wide text-gray-500">Stored value (saved to lead)</Label>
                              <Input
                                value={item.value}
                                onChange={(e) => updateDropdownItem(index, "value", e.target.value)}
                                placeholder="e.g. SCHEDULE_APPT"
                                data-testid={`input-dropdown-value-${index}`}
                              />
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => removeDropdownItem(index)} className="mt-5">
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500 whitespace-nowrap">Go to:</span>
                          <Select
                            value={item.nextStep || "__auto__"}
                            onValueChange={(v) => updateDropdownItem(index, "nextStep", v === "__auto__" ? "" : v)}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select next step" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__auto__">Next step in order</SelectItem>
                              {availableSteps.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="border-t pt-2 mt-1">
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`followup-toggle-${index}`}
                              checked={!!item.followUpPrompt}
                              onCheckedChange={(on) => {
                                if (!on) {
                                  updateDropdownItem(index, "followUpPrompt", "");
                                } else {
                                  updateDropdownItem(index, "followUpPrompt", "Please specify:");
                                }
                              }}
                            />
                            <Label htmlFor={`followup-toggle-${index}`} className="text-xs cursor-pointer text-gray-600">
                              Ask a follow-up question
                            </Label>
                          </div>
                          {!!item.followUpPrompt && (
                            <div className="mt-2 space-y-2 pl-2 border-l-2 border-amber-300">
                              <div>
                                <Label className="text-xs text-gray-500">Follow-up prompt</Label>
                                <Input
                                  value={item.followUpPrompt}
                                  onChange={(e) => updateDropdownItem(index, "followUpPrompt", e.target.value)}
                                  placeholder='e.g. "Please specify your requirement"'
                                  className="text-sm"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={addDropdownItem}>
                      <Plus className="h-4 w-4 mr-1" /> Add Option
                    </Button>
                    {stepDropdownItems.length > 10 && (
                      <p className="text-xs text-blue-600 mt-1">
                        {stepDropdownItems.length} options — will be paginated automatically on WhatsApp (10 per page).
                      </p>
                    )}
                  </>
                )}

                {/* Dependent dropdown toggle */}
                <div className="flex items-center gap-2 pt-2 border-t mt-1">
                  <Switch
                    id="dep-toggle"
                    checked={stepDependsOnFields.length > 0}
                    onCheckedChange={(on) => {
                      if (!on) {
                        setStepDependsOnFields([]);
                        setStepConditionalMappings([]);
                        setStepFallbackItems([]);
                      } else {
                        setStepDependsOnFields([""]);
                      }
                    }}
                  />
                  <Label htmlFor="dep-toggle" className="text-sm cursor-pointer font-medium">
                    Options depend on a prior step's answer
                  </Label>
                </div>

                {stepDependsOnFields.length > 0 && (
                  <div className="space-y-4 border rounded-lg p-3 bg-blue-50 border-blue-200">
                    {/* Info box */}
                    <p className="text-xs text-blue-700 bg-blue-100 rounded p-2 leading-relaxed">
                      <strong>Cascading dropdown:</strong> Select which prior field(s) control this step's options.
                      For a 3-level cascade (e.g. Dealer → City → Store), the Store step should depend on both <em>dealer_name</em> and <em>city_name</em>.
                      The lookup key is the parent values joined by "|" (e.g. "Homelane|Bengaluru"). Items over 10 are split into sections automatically.
                    </p>

                    {/* Parent field selector(s) */}
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-700 font-semibold">Parent field(s) that control options</Label>
                      {stepDependsOnFields.map((field, fi) => (
                        <div key={fi} className="flex gap-2 items-center">
                          <Select
                            value={field || "__none__"}
                            onValueChange={(v) => {
                              const updated = [...stepDependsOnFields];
                              updated[fi] = v === "__none__" ? "" : v;
                              setStepDependsOnFields(updated);
                            }}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select a field from a prior step..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Select field...</SelectItem>
                              {(stepsData?.steps || [])
                                .filter(s => s.saveToField && (!editingStep || s.stepOrder < editingStep.stepOrder))
                                .map(s => (
                                  <SelectItem key={s.saveToField!} value={s.saveToField!}>
                                    {s.saveToField} — Step {s.stepOrder + 1}
                                  </SelectItem>
                                ))
                              }
                            </SelectContent>
                          </Select>
                          {stepDependsOnFields.length > 1 && (
                            <Button variant="ghost" size="icon" onClick={() =>
                              setStepDependsOnFields(prev => prev.filter((_, i) => i !== fi))
                            }>
                              <X className="h-4 w-4 text-red-400" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {stepDependsOnFields.length < 3 && (
                        <Button variant="outline" size="sm" onClick={() =>
                          setStepDependsOnFields(prev => [...prev, ""])
                        }>
                          <Plus className="h-3 w-3 mr-1" /> Add another parent field
                        </Button>
                      )}
                      {stepDependsOnFields.length > 1 && (
                        <p className="text-xs text-gray-500 font-mono bg-white rounded px-2 py-1 border">
                          Composite key: {stepDependsOnFields.map(f => f || "?").join(" | ")}
                        </p>
                      )}
                    </div>

                    {/* Per-key option mappings */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <Label className="text-xs text-gray-700 font-semibold">
                          Options per {stepDependsOnFields.filter(Boolean).join(" + ") || "parent value"}
                        </Label>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            disabled={stepDependsOnFields.filter(Boolean).length === 0}
                            onClick={() => {
                              const parents = stepDependsOnFields.filter(Boolean);
                              if (parents.length === 0) return;
                              const exampleRow: Record<string, string> = {};
                              parents.forEach((f, i) => {
                                exampleRow[f] = i === 0 ? "ExampleParentValue" : `ExamplePart${i + 1}`;
                              });
                              exampleRow["Label"] = "Example Option";
                              exampleRow["Value"] = "example_option";
                              exampleRow["FollowUpPrompt"] = "";
                              const secondRow = { ...exampleRow, Label: "Another Option", Value: "another_option" };
                              const ws = XLSX.utils.json_to_sheet([exampleRow, secondRow]);
                              const wb = XLSX.utils.book_new();
                              XLSX.utils.book_append_sheet(wb, ws, "ConditionalOptions");
                              XLSX.writeFile(wb, "conditional-options-template.xlsx");
                            }}
                            data-testid="button-download-conditional-template"
                          >
                            <Download className="h-3 w-3 mr-1" /> Template
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            disabled={stepDependsOnFields.filter(Boolean).length === 0}
                            onClick={() => conditionalExcelInputRef.current?.click()}
                            data-testid="button-upload-conditional-excel"
                          >
                            <Upload className="h-3 w-3 mr-1" /> Upload Excel
                          </Button>
                          <span className="text-xs text-gray-400">{stepConditionalMappings.length} mapping(s)</span>
                        </div>
                        <input
                          ref={conditionalExcelInputRef}
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          className="hidden"
                          data-testid="input-conditional-excel-file"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              try {
                                const rows = await readWorkbookFromFile(file);
                                const parents = stepDependsOnFields.filter(Boolean);
                                const result = parseConditionalMappingsRows(rows, parents, stepConditionalMappings);
                                setConditionalExcelPreview({ fileName: file.name, result });
                              } catch (err) {
                                toast({
                                  title: "Could not read file",
                                  description: err instanceof Error ? err.message : "Unknown error",
                                  variant: "destructive",
                                });
                              }
                            }
                            if (conditionalExcelInputRef.current) conditionalExcelInputRef.current.value = "";
                          }}
                        />
                      </div>

                      {stepConditionalMappings.map((mapping, mi) => (
                        <div key={mi} className="border rounded-lg p-2 bg-white space-y-2">
                          <div className="flex gap-2 items-center">
                            {stepDependsOnFields.length === 1 ? (() => {
                              const parentOpts = getParentStepOptions(stepDependsOnFields[0]);
                              return parentOpts.length > 0 ? (
                                <Select
                                  value={mapping.key}
                                  onValueChange={v => {
                                    const updated = [...stepConditionalMappings];
                                    updated[mi] = { ...updated[mi], key: v };
                                    setStepConditionalMappings(updated);
                                  }}
                                >
                                  <SelectTrigger className="flex-1 text-sm font-mono">
                                    <SelectValue placeholder={`When ${stepDependsOnFields[0]} = ...`} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {parentOpts.map(opt => (
                                      <SelectItem key={opt.id} value={opt.title}>{opt.title}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input
                                  value={mapping.key}
                                  onChange={e => {
                                    const updated = [...stepConditionalMappings];
                                    updated[mi] = { ...updated[mi], key: e.target.value };
                                    setStepConditionalMappings(updated);
                                  }}
                                  placeholder={`When ${stepDependsOnFields[0] || "parent"} = ...`}
                                  className="flex-1 text-sm font-mono"
                                />
                              );
                            })() : stepDependsOnFields.length > 1 ? (
                              <div className="flex-1 space-y-1">
                                {stepDependsOnFields.map((field, fi) => {
                                  const parentOpts = getParentStepOptions(field);
                                  const keyParts = mapping.key.split("|");
                                  const partValue = keyParts[fi] ?? "";
                                  const updatePart = (v: string) => {
                                    const parts = mapping.key.split("|");
                                    while (parts.length < stepDependsOnFields.length) parts.push("");
                                    parts[fi] = v;
                                    const updated = [...stepConditionalMappings];
                                    updated[mi] = { ...updated[mi], key: parts.join("|") };
                                    setStepConditionalMappings(updated);
                                  };
                                  return parentOpts.length > 0 ? (
                                    <Select key={fi} value={partValue} onValueChange={updatePart}>
                                      <SelectTrigger className="w-full text-sm font-mono">
                                        <SelectValue placeholder={`${field} value...`} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {parentOpts.map(opt => (
                                          <SelectItem key={opt.id} value={opt.title}>{opt.title}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Input
                                      key={fi}
                                      value={partValue}
                                      onChange={e => updatePart(e.target.value)}
                                      placeholder={`${field} value...`}
                                      className="w-full text-sm font-mono"
                                    />
                                  );
                                })}
                                {mapping.key && (
                                  <p className="text-xs text-gray-400 font-mono px-1">
                                    Key: "{mapping.key}"
                                  </p>
                                )}
                              </div>
                            ) : (
                              <Input
                                value={mapping.key}
                                onChange={e => {
                                  const updated = [...stepConditionalMappings];
                                  updated[mi] = { ...updated[mi], key: e.target.value };
                                  setStepConditionalMappings(updated);
                                }}
                                placeholder="When parent = ..."
                                className="flex-1 text-sm font-mono"
                              />
                            )}
                            <Button variant="ghost" size="icon" onClick={() =>
                              setStepConditionalMappings(prev => prev.filter((_, i) => i !== mi))
                            }>
                              <Trash2 className="h-4 w-4 text-red-400" />
                            </Button>
                          </div>
                          <div className="pl-2 space-y-1">
                            {mapping.items.map((item, ii) => (
                              <div key={ii} className="space-y-1">
                                <div className="flex gap-2 items-start">
                                  <div className="flex-1 grid grid-cols-2 gap-2">
                                    <Input
                                      value={item.title}
                                      onChange={e => {
                                        const updated = [...stepConditionalMappings];
                                        const title = e.target.value;
                                        updated[mi].items[ii] = {
                                          ...updated[mi].items[ii],
                                          id: title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `opt_${ii}`,
                                          title,
                                        };
                                        setStepConditionalMappings(updated);
                                      }}
                                      placeholder="Label (shown)"
                                      className="text-sm"
                                    />
                                    <Input
                                      value={item.value}
                                      onChange={e => {
                                        const updated = [...stepConditionalMappings];
                                        updated[mi].items[ii] = { ...updated[mi].items[ii], value: e.target.value };
                                        setStepConditionalMappings(updated);
                                      }}
                                      placeholder="Stored value"
                                      className="text-sm"
                                    />
                                  </div>
                                  <Button variant="ghost" size="icon" onClick={() => {
                                    const updated = [...stepConditionalMappings];
                                    updated[mi].items = updated[mi].items.filter((_, i) => i !== ii);
                                    setStepConditionalMappings(updated);
                                  }}>
                                    <X className="h-3 w-3 text-red-400" />
                                  </Button>
                                </div>
                                <div className="ml-2">
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      id={`cond-followup-${mi}-${ii}`}
                                      checked={!!item.followUpPrompt}
                                      onCheckedChange={(on) => {
                                        const updated = [...stepConditionalMappings];
                                        updated[mi].items[ii] = {
                                          ...updated[mi].items[ii],
                                          followUpPrompt: on ? "Please specify:" : "",
                                        };
                                        setStepConditionalMappings(updated);
                                      }}
                                    />
                                    <Label htmlFor={`cond-followup-${mi}-${ii}`} className="text-xs cursor-pointer text-gray-600">
                                      Ask a follow-up question
                                    </Label>
                                  </div>
                                  {!!item.followUpPrompt && (
                                    <div className="mt-1 space-y-1 pl-2 border-l-2 border-amber-300">
                                      <div>
                                        <Label className="text-xs text-gray-500">Follow-up prompt</Label>
                                        <Input
                                          value={item.followUpPrompt}
                                          onChange={(e) => {
                                            const updated = [...stepConditionalMappings];
                                            updated[mi].items[ii] = { ...updated[mi].items[ii], followUpPrompt: e.target.value };
                                            setStepConditionalMappings(updated);
                                          }}
                                          placeholder='e.g. "Please specify your requirement"'
                                          className="text-sm"
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                            <Button variant="outline" size="sm" className="text-xs mt-1" onClick={() => {
                              const updated = [...stepConditionalMappings];
                              updated[mi].items.push({ id: `opt_${updated[mi].items.length}`, title: '', value: '' });
                              setStepConditionalMappings(updated);
                            }}>
                              <Plus className="h-3 w-3 mr-1" /> Add option
                            </Button>
                            {mapping.items.length > 10 && (
                              <p className="text-xs text-blue-600 mt-1">
                                {mapping.items.length} options — will be paginated automatically on WhatsApp (10 per page).
                              </p>
                            )}
                          </div>
                        </div>
                      ))}

                      <Button variant="outline" size="sm" onClick={() =>
                        setStepConditionalMappings(prev => [...prev, { key: '', items: [] }])
                      }>
                        <Plus className="h-4 w-4 mr-1" /> Add mapping
                      </Button>
                    </div>

                    {/* Fallback options */}
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-700 font-semibold">
                        Fallback options <span className="font-normal text-gray-500">(shown if no match found)</span>
                      </Label>
                      {stepFallbackItems.map((item, fi) => (
                        <div key={fi} className="space-y-1">
                          <div className="flex gap-2 items-start">
                            <div className="flex-1 grid grid-cols-2 gap-2">
                              <Input
                                value={item.title}
                                onChange={e => {
                                  const updated = [...stepFallbackItems];
                                  const title = e.target.value;
                                  updated[fi] = {
                                    ...updated[fi],
                                    id: title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `fb_${fi}`,
                                    title,
                                  };
                                  setStepFallbackItems(updated);
                                }}
                                placeholder="Label (shown)"
                                className="text-sm"
                              />
                              <Input
                                value={item.value}
                                onChange={e => {
                                  const updated = [...stepFallbackItems];
                                  updated[fi] = { ...updated[fi], value: e.target.value };
                                  setStepFallbackItems(updated);
                                }}
                                placeholder="Stored value"
                                className="text-sm"
                              />
                            </div>
                            <Button variant="ghost" size="icon" onClick={() =>
                              setStepFallbackItems(prev => prev.filter((_, i) => i !== fi))
                            }>
                              <X className="h-3 w-3 text-red-400" />
                            </Button>
                          </div>
                          <div className="ml-2">
                            <div className="flex items-center gap-2">
                              <Switch
                                id={`fb-followup-${fi}`}
                                checked={!!item.followUpPrompt}
                                onCheckedChange={(on) => {
                                  const updated = [...stepFallbackItems];
                                  updated[fi] = {
                                    ...updated[fi],
                                    followUpPrompt: on ? "Please specify:" : "",
                                  };
                                  setStepFallbackItems(updated);
                                }}
                              />
                              <Label htmlFor={`fb-followup-${fi}`} className="text-xs cursor-pointer text-gray-600">
                                Ask a follow-up question
                              </Label>
                            </div>
                            {!!item.followUpPrompt && (
                              <div className="mt-1 space-y-1 pl-2 border-l-2 border-amber-300">
                                <div>
                                  <Label className="text-xs text-gray-500">Follow-up prompt</Label>
                                  <Input
                                    value={item.followUpPrompt}
                                    onChange={(e) => {
                                      const updated = [...stepFallbackItems];
                                      updated[fi] = { ...updated[fi], followUpPrompt: e.target.value };
                                      setStepFallbackItems(updated);
                                    }}
                                    placeholder='e.g. "Please specify your requirement"'
                                    className="text-sm"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() =>
                        setStepFallbackItems(prev => [...prev, { id: `fb_${prev.length}`, title: '', value: '' }])
                      }>
                        <Plus className="h-3 w-3 mr-1" /> Add fallback
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {stepType !== "buttons" && stepType !== "dropdown" && stepType !== "end" && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Label>Next Step</Label>
                  <div className="group relative">
                    <Info className="h-4 w-4 text-gray-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-50">
                      Where to go after this step. Leave empty to go to the next step in order.
                    </div>
                  </div>
                </div>
                <Select value={stepDefaultNext || "__auto__"} onValueChange={(v) => setStepDefaultNext(v === "__auto__" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Next step in order" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">Next step in order</SelectItem>
                    {availableSteps.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

          </div>
          <div className="pt-4 border-t mt-4 flex-shrink-0">
            <Button onClick={handleSaveStep} disabled={!stepPrompt} className="w-full">
              {editingStep ? "Update Step" : "Add Step"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!conditionalExcelPreview}
        onOpenChange={(open) => { if (!open) setConditionalExcelPreview(null); }}
      >
        <DialogContent className="max-w-2xl" data-testid="dialog-conditional-excel-preview">
          <DialogHeader>
            <DialogTitle>Import preview</DialogTitle>
            <DialogDescription>
              {conditionalExcelPreview?.fileName && `From ${conditionalExcelPreview.fileName}. `}
              Review before applying. Existing options are preserved — only net-new rows are merged in.
            </DialogDescription>
          </DialogHeader>
          {conditionalExcelPreview && (
            <div className="space-y-3 text-sm">
              {conditionalExcelPreview.result.errors.length > 0 ? (
                <div className="rounded-md bg-red-50 border border-red-200 p-3 space-y-1">
                  <p className="font-semibold text-red-700">Cannot import:</p>
                  {conditionalExcelPreview.result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-700">• {e}</p>
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ["Rows found", conditionalExcelPreview.result.stats.totalRows],
                      ["Valid rows", conditionalExcelPreview.result.stats.validRows],
                      ["New keys", conditionalExcelPreview.result.stats.newKeys],
                      ["New options", conditionalExcelPreview.result.stats.newItems],
                      ["Duplicates skipped", conditionalExcelPreview.result.stats.duplicatesSkipped],
                      ["Invalid skipped", conditionalExcelPreview.result.stats.invalidSkipped],
                    ] as [string, number][]).map(([label, val]) => (
                      <div key={label} className="rounded-md bg-gray-50 border p-2">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="text-lg font-semibold" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>{val}</p>
                      </div>
                    ))}
                  </div>
                  {conditionalExcelPreview.result.preview.length > 0 ? (
                    <div className="border rounded-md max-h-64 overflow-y-auto p-2 space-y-2">
                      {conditionalExcelPreview.result.preview.slice(0, 20).map(({ key, addedItems }) => (
                        <div key={key} className="text-xs">
                          <p className="font-mono font-semibold text-gray-700">{key}</p>
                          <ul className="pl-3 text-gray-600">
                            {addedItems.slice(0, 5).map((it, idx) => (
                              <li key={idx}>+ {it.title} <span className="text-gray-400">→ {it.value}</span></li>
                            ))}
                            {addedItems.length > 5 && (
                              <li className="text-gray-400">…and {addedItems.length - 5} more</li>
                            )}
                          </ul>
                        </div>
                      ))}
                      {conditionalExcelPreview.result.preview.length > 20 && (
                        <p className="text-xs text-gray-400">…and {conditionalExcelPreview.result.preview.length - 20} more keys</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 italic">Nothing new to add — all rows are duplicates or invalid.</p>
                  )}
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConditionalExcelPreview(null)} data-testid="button-cancel-import">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (conditionalExcelPreview) {
                  const { result } = conditionalExcelPreview;
                  setStepConditionalMappings(result.mergedMappings);
                  toast({
                    title: "Options imported",
                    description: `Added ${result.stats.newItems} option(s) across ${result.stats.newKeys} new key(s). Click Update Step to save.`,
                  });
                }
                setConditionalExcelPreview(null);
              }}
              disabled={
                !conditionalExcelPreview ||
                conditionalExcelPreview.result.errors.length > 0 ||
                conditionalExcelPreview.result.stats.newItems === 0
              }
              data-testid="button-apply-import"
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
