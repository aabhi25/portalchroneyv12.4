import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  ArrowLeft, Save, Upload, Loader2, GraduationCap, AlertTriangle, Check, Plus, Trash2, Edit2, X, 
  Sparkles, Bold, Italic, Route, UserCheck, Phone, Mail, MessageSquare,
  ChevronUp, ChevronDown, User, Brain, AlertCircle, CheckCircle2, Users, Clock, Link2, Eye, EyeOff, Pencil, Menu,
  Folder, GripVertical, ChevronRight, ExternalLink, FileText, Settings, Volume2, Bell, Zap, ClipboardList
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { apiRequest } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DetailsBuilder, parseDetailsConfig, stringifyDetailsConfig } from "@/components/DetailsBuilder";

const renderFormattedText = (text: string) => {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  
  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/\*(.+?)\*/);
    
    let firstMatch: { index: number; length: number; content: string; type: 'bold' | 'italic' } | null = null;
    
    if (boldMatch && boldMatch.index !== undefined) {
      firstMatch = { index: boldMatch.index, length: boldMatch[0].length, content: boldMatch[1], type: 'bold' };
    }
    
    if (italicMatch && italicMatch.index !== undefined) {
      if (!firstMatch || italicMatch.index < firstMatch.index) {
        if (!boldMatch || italicMatch.index !== boldMatch.index) {
          firstMatch = { index: italicMatch.index, length: italicMatch[0].length, content: italicMatch[1], type: 'italic' };
        }
      }
    }
    
    if (firstMatch) {
      if (firstMatch.index > 0) {
        parts.push(<span key={key++}>{remaining.substring(0, firstMatch.index)}</span>);
      }
      if (firstMatch.type === 'bold') {
        parts.push(<strong key={key++} className="font-semibold">{firstMatch.content}</strong>);
      } else {
        parts.push(<em key={key++} className="italic">{firstMatch.content}</em>);
      }
      remaining = remaining.substring(firstMatch.index + firstMatch.length);
    } else {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
  }
  
  return <>{parts}</>;
};

interface GroupTrainingResponse {
  groupId: string;
  groupName: string;
  memberCount: number;
  training: {
    id: string;
    groupId: string;
    customInstructions: string | null;
    leadTrainingConfig: LeadTrainingConfig | null;
    fallbackTemplate: string | null;
    lastPublishedAt: string | null;
    lastPublishedBy: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

type PhoneValidation = 'any' | '10' | '12' | '8-12';

interface LeadField {
  id: string;
  enabled: boolean;
  required: boolean;
  priority: number;
  captureStrategy: 'smart' | 'start' | 'end' | 'intent';
  phoneValidation?: PhoneValidation;
}

interface LeadTrainingConfig {
  fields: LeadField[];
  captureStrategy: 'smart' | 'start' | 'end' | 'intent';
}

interface Instruction {
  id: string;
  text: string;
  type: 'always' | 'conditional' | 'fallback';
  keywords?: string[];
}

interface GroupLeadsquaredFieldMapping {
  id: string;
  groupId: string;
  leadsquaredField: string;
  sourceType: 'dynamic' | 'custom';
  sourceField: string | null;
  customValue: string | null;
  fallbackValue: string | null;
  displayName: string;
  isEnabled: boolean;
  sortOrder: number;
}

interface MenuItem {
  id: string;
  parentId: string | null;
  title: string;
  subtitle: string | null;
  icon: string;
  iconBgColor: string;
  iconColor: string;
  sortOrder: number;
  itemType: string;
  actionValue: string | null;
  leadFormFields: string | null;
  isActive: string;
}

interface LeadFormFieldConfig {
  visible: boolean;
  required: boolean;
}

interface CustomLeadField {
  id: string;
  label: string;
  fieldType: 'text' | 'dropdown' | 'textarea';
  options?: string[];
  required: boolean;
}

interface LeadFormFieldsConfig {
  name?: LeadFormFieldConfig;
  phone?: LeadFormFieldConfig;
  email?: LeadFormFieldConfig;
  custom?: CustomLeadField[];
}

const parseLeadFormFields = (str?: string): LeadFormFieldsConfig => {
  if (!str) {
    return { name: { visible: true, required: true }, phone: { visible: true, required: false }, custom: [] };
  }
  try {
    const parsed = JSON.parse(str);
    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...parsed, custom: parsed.custom || [] };
    }
  } catch {
    const fields = str.split(",").filter(f => f);
    const result: LeadFormFieldsConfig = { custom: [] };
    fields.forEach((f, i) => {
      (result as any)[f] = { visible: true, required: i === 0 };
    });
    return result;
  }
  return { name: { visible: true, required: true }, phone: { visible: true, required: false }, custom: [] };
};

const stringifyLeadFormFields = (config: LeadFormFieldsConfig): string => {
  return JSON.stringify(config);
};

const iconOptions = [
  { value: "folder", label: "Folder" },
  { value: "message-square", label: "Chat" },
  { value: "phone", label: "Phone" },
  { value: "book-open", label: "Book" },
  { value: "graduation-cap", label: "Graduation Cap" },
  { value: "briefcase", label: "Briefcase" },
  { value: "shopping-bag", label: "Shopping Bag" },
  { value: "star", label: "Star" },
  { value: "heart", label: "Heart" },
  { value: "help-circle", label: "Help" },
];

const itemTypeOptions = [
  { value: "navigate", label: "Navigate to Submenu", icon: Folder },
  { value: "chat", label: "Open AI Chat", icon: MessageSquare },
  { value: "url", label: "Open URL", icon: ExternalLink },
  { value: "phone", label: "Call Phone", icon: Phone },
  { value: "form", label: "Open Journey/Form", icon: FileText },
  { value: "lead_form", label: "Open Lead Form", icon: ClipboardList },
  { value: "detail", label: "Show Details", icon: Eye },
];

const LSQ_DYNAMIC_SOURCE_OPTIONS = [
  { value: 'lead.name', label: 'Lead Name' },
  { value: 'lead.email', label: 'Lead Email' },
  { value: 'lead.phone', label: 'Lead Phone' },
  { value: 'lead.whatsapp', label: 'Lead WhatsApp' },
  { value: 'lead.createdAt', label: 'Lead Created At' },
  { value: 'lead.sourceUrl', label: 'Lead Source URL (Page URL)' },
  { value: 'lead.captchaStatus', label: 'CAPTCHA Status (verified/unverified)' },
  { value: 'session.city', label: 'Visitor City' },
  { value: 'session.utmCampaign', label: 'UTM Campaign' },
  { value: 'session.utmSource', label: 'UTM Source' },
  { value: 'session.utmMedium', label: 'UTM Medium' },
  { value: 'session.pageUrl', label: 'Page URL' },
  { value: 'business.name', label: 'Business Name' },
  { value: 'business.website', label: 'Business Website URL' },
];

const DEFAULT_LEAD_CONFIG: LeadTrainingConfig = {
  fields: [
    { id: 'name', enabled: false, required: false, priority: 1, captureStrategy: 'start' },
    { id: 'mobile', enabled: false, required: false, priority: 2, captureStrategy: 'start', phoneValidation: '10' },
    { id: 'whatsapp', enabled: false, required: false, priority: 3, captureStrategy: 'start', phoneValidation: '10' },
    { id: 'email', enabled: false, required: false, priority: 4, captureStrategy: 'start' }
  ],
  captureStrategy: 'start'
};

const getFieldIcon = (fieldId: string) => {
  switch (fieldId) {
    case 'name': return <User className="w-4 h-4" />;
    case 'mobile': return <Phone className="w-4 h-4" />;
    case 'whatsapp': return <MessageSquare className="w-4 h-4" />;
    case 'email': return <Mail className="w-4 h-4" />;
    default: return <User className="w-4 h-4" />;
  }
};

const getFieldLabel = (fieldId: string) => {
  switch (fieldId) {
    case 'name': return 'Name';
    case 'mobile': return 'Mobile Number';
    case 'whatsapp': return 'WhatsApp Number';
    case 'email': return 'Email Address';
    default: return fieldId;
  }
};

export default function GroupTrainingEditor() {
  const { groupId } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [newInstruction, setNewInstruction] = useState("");
  const [newInstructionType, setNewInstructionType] = useState<'always' | 'conditional' | 'fallback'>('always');
  const [newKeywords, setNewKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [instructionToDelete, setInstructionToDelete] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  
  const [refineDialogOpen, setRefineDialogOpen] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [originalInstruction, setOriginalInstruction] = useState("");
  const [refinedInstruction, setRefinedInstruction] = useState("");
  const [refiningExistingId, setRefiningExistingId] = useState<string | null>(null);
  
  const [leadConfigEnabled, setLeadConfigEnabled] = useState(false);
  const [leadTrainingConfig, setLeadTrainingConfig] = useState<LeadTrainingConfig>(DEFAULT_LEAD_CONFIG);
  
  const [hasChanges, setHasChanges] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("instructions");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  
  // LeadSquared state
  const [lsqEnabled, setLsqEnabled] = useState(false);
  const [lsqHost, setLsqHost] = useState("");
  const [lsqAccessKey, setLsqAccessKey] = useState("");
  const [lsqSecretKey, setLsqSecretKey] = useState("");
  const [showLsqSecretKey, setShowLsqSecretKey] = useState(false);
  const [lsqSecretKeyChanged, setLsqSecretKeyChanged] = useState(false);
  const [savingLsq, setSavingLsq] = useState(false);
  const [lsqFieldMappings, setLsqFieldMappings] = useState<GroupLeadsquaredFieldMapping[]>([]);
  const [loadingLsqMappings, setLoadingLsqMappings] = useState(false);
  const [showLsqMappingDialog, setShowLsqMappingDialog] = useState(false);
  const [editingLsqMapping, setEditingLsqMapping] = useState<GroupLeadsquaredFieldMapping | null>(null);
  const [savingLsqMapping, setSavingLsqMapping] = useState(false);
  const [deletingLsqMappingId, setDeletingLsqMappingId] = useState<string | null>(null);
  const [showLsqDeleteDialog, setShowLsqDeleteDialog] = useState(false);
  const [newLsqMapping, setNewLsqMapping] = useState({
    leadsquaredField: '',
    sourceType: 'dynamic' as 'dynamic' | 'custom',
    sourceField: '',
    customValue: '',
    displayName: '',
    fallbackValue: '',
  });
  
  // Menu Builder state
  const [menuEnabled, setMenuEnabled] = useState(false);
  const [menuWelcomeMessage, setMenuWelcomeMessage] = useState("");
  const [menuAvatarUrl, setMenuAvatarUrl] = useState("");
  const [menuPersistentCtaEnabled, setMenuPersistentCtaEnabled] = useState(false);
  const [menuPersistentCtaLabel, setMenuPersistentCtaLabel] = useState("");
  const [menuPersistentCtaAction, setMenuPersistentCtaAction] = useState<"chat" | "url" | "phone" | "lead_form">("chat");
  const [menuPersistentCtaValue, setMenuPersistentCtaValue] = useState("");
  const [menuPersistentCtaIcon, setMenuPersistentCtaIcon] = useState("");
  const [menuQuickChips, setMenuQuickChips] = useState<{label: string; emoji?: string; action: string; actionValue?: string}[]>([]);
  const [menuFooterText, setMenuFooterText] = useState("");
  const [menuFooterLinkText, setMenuFooterLinkText] = useState("");
  const [menuFooterLinkUrl, setMenuFooterLinkUrl] = useState("");
  const [menuLeadFormFields, setMenuLeadFormFields] = useState<LeadFormFieldsConfig>({name: {visible: true, required: true}, phone: {visible: true, required: false}});
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [editingMenuItem, setEditingMenuItem] = useState<MenuItem | null>(null);
  const [showItemAddCustomField, setShowItemAddCustomField] = useState(false);
  const [newItemCustomField, setNewItemCustomField] = useState<{ label: string; fieldType: 'text' | 'dropdown' | 'textarea'; options: string; required: boolean }>({ label: '', fieldType: 'text', options: '', required: false });
  const [isAddMenuItemDialogOpen, setIsAddMenuItemDialogOpen] = useState(false);
  const [selectedMenuParentId, setSelectedMenuParentId] = useState<string | null>(null);
  const [newMenuItem, setNewMenuItem] = useState({
    title: "",
    subtitle: "",
    icon: "folder",
    iconBgColor: "#E0E7FF",
    iconColor: "#4F46E5",
    itemType: "navigate",
    actionValue: "",
  });
  
  // Journey Training state
  const [groupJourneysList, setGroupJourneysList] = useState<any[]>([]);
  const [selectedGroupJourneyId, setSelectedGroupJourneyId] = useState<string | null>(null);
  const [selectedGroupJourney, setSelectedGroupJourney] = useState<any>(null);
  const [showJourneyTemplates, setShowJourneyTemplates] = useState(false);
  const [journeyStepDialogOpen, setJourneyStepDialogOpen] = useState(false);
  const [editingJourneyStep, setEditingJourneyStep] = useState<any>(null);
  const [editingGroupJourneyName, setEditingGroupJourneyName] = useState(false);
  const [editedGroupJourneyName, setEditedGroupJourneyName] = useState("");
  const [editingGroupJourneyDesc, setEditingGroupJourneyDesc] = useState(false);
  const [editedGroupJourneyDesc, setEditedGroupJourneyDesc] = useState("");
  const [deleteGroupJourneyOpen, setDeleteGroupJourneyOpen] = useState(false);
  const [journeyToDeleteId, setJourneyToDeleteId] = useState<string | null>(null);
  const [publishingJourneys, setPublishingJourneys] = useState(false);
  const [journeyDraggedStepId, setJourneyDraggedStepId] = useState<string | null>(null);
  const [journeyStepForm, setJourneyStepForm] = useState({
    questionText: "",
    questionType: "text",
    isRequired: "true",
    toolTrigger: "none",
    multipleChoiceOptions: [] as string[],
    exitOnValue: "",
    exitMessage: "",
    skipOnValue: "",
    skipToStepIndex: null as number | null,
    isConditional: false,
    completionButtonText: "",
  });

  // Extra Settings state
  const [extraResponseLength, setExtraResponseLength] = useState("balanced");
  const [extraAutoOpenChat, setExtraAutoOpenChat] = useState("false");
  const [extraOpeningSoundEnabled, setExtraOpeningSoundEnabled] = useState(true);
  const [extraOpeningSoundStyle, setExtraOpeningSoundStyle] = useState("chime");
  const [extraInactivityNudgeEnabled, setExtraInactivityNudgeEnabled] = useState(true);
  const [extraInactivityNudgeDelay, setExtraInactivityNudgeDelay] = useState("45");
  const [extraInactivityNudgeMessage, setExtraInactivityNudgeMessage] = useState("Still there? Let me know if you need any help!");
  const [extraSmartNudgeEnabled, setExtraSmartNudgeEnabled] = useState(false);
  const [savingExtra, setSavingExtra] = useState(false);
  const [publishingExtra, setPublishingExtra] = useState(false);
  const [extraLoaded, setExtraLoaded] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: groupTraining, isLoading } = useQuery<GroupTrainingResponse>({
    queryKey: [`/api/super-admin/account-groups/${groupId}/training`],
    enabled: !!groupId,
  });

  const { data: groupJourneys } = useQuery<{ accountId: string; accountName: string; journeys: { id: string; name: string; journeyType: string }[] }[]>({
    queryKey: [`/api/super-admin/account-groups/${groupId}/journeys`],
    enabled: !!groupId,
  });
  
  useEffect(() => {
    if (groupTraining?.training) {
      if (groupTraining.training.customInstructions) {
        try {
          const parsed = JSON.parse(groupTraining.training.customInstructions);
          if (Array.isArray(parsed)) {
            const normalized = parsed.map((instr: any) => ({
              ...instr,
              type: instr.type || 'always',
              keywords: instr.keywords || undefined,
            }));
            setInstructions(normalized);
          }
        } catch {
          const text = groupTraining.training.customInstructions.trim();
          if (text) {
            const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            const converted: Instruction[] = lines.map((line, index) => ({
              id: `legacy-${Date.now()}-${index}`,
              text: line.replace(/^[-*•]\s*/, ''),
              type: 'always' as const,
            }));
            setInstructions(converted);
          }
        }
      }
      
      if (groupTraining.training.leadTrainingConfig) {
        const config = groupTraining.training.leadTrainingConfig as LeadTrainingConfig;
        const hasEnabledField = config.fields.some(f => f.enabled);
        setLeadConfigEnabled(hasEnabledField);
        setLeadTrainingConfig(config);
      } else {
        setLeadConfigEnabled(false);
      }
    }
  }, [groupTraining]);
  
  // Load LeadSquared settings from group training
  useEffect(() => {
    if (groupTraining?.training) {
      const training = groupTraining.training as any;
      setLsqEnabled(training.leadsquaredEnabled || false);
      setLsqHost(training.leadsquaredHost || "");
      setLsqAccessKey(training.leadsquaredAccessKey || "");
      // Don't load the actual secret key for security - just show placeholder if it exists
      if (training.leadsquaredSecretKey) {
        setLsqSecretKey("••••••••••••••••");
      }
      
      // Load Menu Builder config
      if (training.menuConfig) {
        const config = training.menuConfig as any;
        setMenuEnabled(config.enabled === "true");
        setMenuWelcomeMessage(config.welcomeMessage || "");
        setMenuAvatarUrl(config.avatarUrl || "");
        setMenuPersistentCtaEnabled(config.persistentCtaEnabled === "true");
        setMenuPersistentCtaLabel(config.persistentCtaLabel || "");
        setMenuPersistentCtaAction(config.persistentCtaAction || "chat");
        setMenuPersistentCtaValue(config.persistentCtaValue || "");
        setMenuPersistentCtaIcon(config.persistentCtaIcon || "");
        setMenuQuickChips(config.quickChips || []);
        setMenuFooterText(config.footerText || "");
        setMenuFooterLinkText(config.footerLinkText || "");
        setMenuFooterLinkUrl(config.footerLinkUrl || "");
        if (config.leadFormFields) {
          setMenuLeadFormFields(parseLeadFormFields(config.leadFormFields));
        }
      }
      // Load Menu Items
      if (training.menuItems && Array.isArray(training.menuItems)) {
        setMenuItems(training.menuItems as MenuItem[]);
      }
    }
    
    // Also fetch field mappings and group journeys when component loads
    if (groupId) {
      fetchLsqFieldMappings();
      fetchGroupJourneys();
    }
  }, [groupTraining, groupId]);
  
  const fetchLsqFieldMappings = async () => {
    if (!groupId) return;
    try {
      setLoadingLsqMappings(true);
      const response = await fetch(`/api/super-admin/account-groups/${groupId}/leadsquared/field-mappings`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setLsqFieldMappings(data);
      }
    } catch (error) {
      console.error("Error fetching group LSQ field mappings:", error);
    } finally {
      setLoadingLsqMappings(false);
    }
  };
  
  const saveLsqSettings = async () => {
    if (!groupId) return;
    try {
      setSavingLsq(true);
      const payload: any = {
        leadsquaredEnabled: lsqEnabled,
        leadsquaredHost: lsqHost,
        leadsquaredAccessKey: lsqAccessKey,
      };
      // Only include secret key if it was changed
      if (lsqSecretKeyChanged && lsqSecretKey !== "••••••••••••••••") {
        payload.leadsquaredSecretKey = lsqSecretKey;
      }
      
      await apiRequest("PUT", `/api/super-admin/account-groups/${groupId}/training`, payload);
      
      toast({
        title: "LeadSquared settings saved",
        description: "Your LeadSquared configuration has been saved to the group.",
      });
      setLsqSecretKeyChanged(false);
      queryClient.invalidateQueries({ queryKey: [`/api/super-admin/account-groups/${groupId}/training`] });
      
      // Refresh field mappings (defaults may have been seeded)
      fetchLsqFieldMappings();
    } catch (error: any) {
      toast({
        title: "Error saving settings",
        description: error.message || "Failed to save LeadSquared settings",
        variant: "destructive",
      });
    } finally {
      setSavingLsq(false);
    }
  };
  
  const saveLsqFieldMapping = async () => {
    if (!groupId || !newLsqMapping.leadsquaredField || !newLsqMapping.displayName) {
      toast({
        title: "Missing fields",
        description: "LeadSquared field name and display name are required",
        variant: "destructive",
      });
      return;
    }
    
    try {
      setSavingLsqMapping(true);
      const payload = {
        leadsquaredField: newLsqMapping.leadsquaredField,
        sourceType: newLsqMapping.sourceType,
        sourceField: newLsqMapping.sourceType === 'dynamic' ? newLsqMapping.sourceField : null,
        customValue: newLsqMapping.sourceType === 'custom' ? newLsqMapping.customValue : null,
        fallbackValue: newLsqMapping.sourceType === 'dynamic' ? (newLsqMapping.fallbackValue || null) : null,
        displayName: newLsqMapping.displayName,
        isEnabled: true,
        sortOrder: lsqFieldMappings.length,
      };
      
      const url = editingLsqMapping 
        ? `/api/super-admin/account-groups/${groupId}/leadsquared/field-mappings/${editingLsqMapping.id}`
        : `/api/super-admin/account-groups/${groupId}/leadsquared/field-mappings`;
      const method = editingLsqMapping ? "PUT" : "POST";
      
      await apiRequest(method, url, payload);
      
      toast({
        title: editingLsqMapping ? "Mapping updated" : "Mapping created",
        description: `Field mapping for ${newLsqMapping.displayName} has been ${editingLsqMapping ? "updated" : "created"}.`,
      });
      setShowLsqMappingDialog(false);
      setEditingLsqMapping(null);
      setNewLsqMapping({
        leadsquaredField: '',
        sourceType: 'dynamic',
        sourceField: '',
        customValue: '',
        displayName: '',
        fallbackValue: '',
      });
      fetchLsqFieldMappings();
    } catch (error: any) {
      toast({
        title: "Error saving mapping",
        description: error.message || "Failed to save field mapping",
        variant: "destructive",
      });
    } finally {
      setSavingLsqMapping(false);
    }
  };
  
  const deleteLsqFieldMapping = async () => {
    if (!groupId || !deletingLsqMappingId) return;
    
    try {
      const response = await apiRequest("DELETE", `/api/super-admin/account-groups/${groupId}/leadsquared/field-mappings/${deletingLsqMappingId}`);
      
      if (response.ok) {
        toast({
          title: "Mapping deleted",
          description: "Field mapping has been removed.",
        });
        setShowLsqDeleteDialog(false);
        setDeletingLsqMappingId(null);
        fetchLsqFieldMappings();
      } else {
        throw new Error("Failed to delete mapping");
      }
    } catch (error: any) {
      toast({
        title: "Error deleting mapping",
        description: error.message || "Failed to delete field mapping",
        variant: "destructive",
      });
    }
  };
  
  const toggleLsqMappingEnabled = async (mapping: GroupLeadsquaredFieldMapping) => {
    if (!groupId) return;
    
    const newIsEnabled = (mapping.isEnabled === true || mapping.isEnabled === "true") ? "false" : "true";
    
    setLsqFieldMappings(prev => prev.map(m => 
      m.id === mapping.id ? { ...m, isEnabled: newIsEnabled } : m
    ));
    
    try {
      const response = await apiRequest("PUT", `/api/super-admin/account-groups/${groupId}/leadsquared/field-mappings/${mapping.id}`, {
        isEnabled: newIsEnabled,
      });
      
      if (!response.ok) {
        fetchLsqFieldMappings();
      }
    } catch (error) {
      console.error("Error toggling mapping:", error);
      fetchLsqFieldMappings();
    }
  };
  
  // Journey Training functions
  const JOURNEY_TYPES_GROUP = [
    { id: "conversational", name: "Conversational Journey", journeyType: "conversational", description: "AI-guided conversations where questions are asked naturally in chat" },
    { id: "form", name: "Form Journey", journeyType: "form", description: "Step-by-step visual forms with input fields, dropdowns, and radio buttons" },
  ];

  const FIELD_TYPES_GROUP = [
    { value: "text", label: "Text Input" },
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone" },
    { value: "number", label: "Number" },
    { value: "date", label: "Date" },
    { value: "dropdown", label: "Dropdown" },
    { value: "radio", label: "Radio Buttons" },
  ];

  const TOOL_TRIGGERS_GROUP = [
    { value: "none", label: "None (Ask Question)" },
    { value: "capture_lead", label: "Capture Lead" },
    { value: "book_appointment", label: "Book Appointment" },
    { value: "get_products", label: "Get Products" },
    { value: "get_faqs", label: "Get FAQs" },
    { value: "journey_complete", label: "Journey Complete" },
  ];

  const fetchGroupJourneys = async () => {
    if (!groupId) return;
    try {
      const response = await fetch(`/api/super-admin/account-groups/${groupId}/group-journeys`, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        setGroupJourneysList(data);
      }
    } catch (error) {
      console.error("Error fetching group journeys:", error);
    }
  };

  const fetchGroupJourneyWithSteps = async (journeyId: string) => {
    if (!groupId) return;
    try {
      const response = await fetch(`/api/super-admin/account-groups/${groupId}/group-journeys/${journeyId}`, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        setSelectedGroupJourney(data);
      }
    } catch (error) {
      console.error("Error fetching group journey:", error);
    }
  };

  const handleCreateGroupJourney = async (type: typeof JOURNEY_TYPES_GROUP[0]) => {
    if (!groupId) return;
    try {
      const journey = await apiRequest("POST", `/api/super-admin/account-groups/${groupId}/group-journeys`, {
        name: type.name,
        description: type.description,
        templateType: "custom",
        journeyType: type.journeyType,
        status: "active",
        isDefault: "false",
        triggerMode: "manual",
      });
      toast({ title: "Journey created" });
      setShowJourneyTemplates(false);
      fetchGroupJourneys();
      setSelectedGroupJourneyId(journey.id);
      fetchGroupJourneyWithSteps(journey.id);
    } catch (error) {
      toast({ title: "Failed to create journey", variant: "destructive" });
    }
  };

  const handleUpdateGroupJourney = async (journeyId: string, data: any) => {
    if (!groupId) return;
    try {
      const updated = await apiRequest("PUT", `/api/super-admin/account-groups/${groupId}/group-journeys/${journeyId}`, data);
      setSelectedGroupJourney((prev: any) => prev ? { ...prev, ...updated } : prev);
      setGroupJourneysList(prev => prev.map(j => j.id === journeyId ? { ...j, ...updated } : j));
      toast({ title: "Journey updated" });
    } catch (error) {
      toast({ title: "Failed to update journey", variant: "destructive" });
    }
  };

  const handleDeleteGroupJourney = async () => {
    if (!groupId || !journeyToDeleteId) return;
    try {
      await apiRequest("DELETE", `/api/super-admin/account-groups/${groupId}/group-journeys/${journeyToDeleteId}`);
      toast({ title: "Journey deleted" });
      setDeleteGroupJourneyOpen(false);
      setJourneyToDeleteId(null);
      if (selectedGroupJourneyId === journeyToDeleteId) {
        setSelectedGroupJourneyId(null);
        setSelectedGroupJourney(null);
      }
      fetchGroupJourneys();
    } catch (error) {
      toast({ title: "Failed to delete journey", variant: "destructive" });
    }
  };

  const resetJourneyStepForm = () => {
    setJourneyStepForm({
      questionText: "",
      questionType: "text",
      isRequired: "true",
      toolTrigger: "none",
      multipleChoiceOptions: [],
      exitOnValue: "",
      exitMessage: "",
      skipOnValue: "",
      skipToStepIndex: null,
      isConditional: false,
      completionButtonText: "",
    });
  };

  const handleEditJourneyStep = (step: any) => {
    setEditingJourneyStep(step);
    let parsedOptions: string[] = [];
    if (step.multipleChoiceOptions) {
      try { parsedOptions = typeof step.multipleChoiceOptions === 'string' ? JSON.parse(step.multipleChoiceOptions) : step.multipleChoiceOptions; } catch (e) {}
    }
    setJourneyStepForm({
      questionText: step.questionText || "",
      questionType: step.questionType || "text",
      isRequired: step.isRequired || "true",
      toolTrigger: step.toolTrigger || "none",
      multipleChoiceOptions: Array.isArray(parsedOptions) ? parsedOptions : [],
      exitOnValue: step.exitOnValue || "",
      exitMessage: step.exitMessage || "",
      skipOnValue: step.skipOnValue || "",
      skipToStepIndex: step.skipToStepIndex ?? null,
      isConditional: step.isConditional === "true" || step.isConditional === true,
      completionButtonText: step.completionButtonText || "",
    });
    setJourneyStepDialogOpen(true);
  };

  const handleSaveJourneyStep = async () => {
    if (!groupId || !selectedGroupJourney) return;
    const stepData = {
      ...journeyStepForm,
      multipleChoiceOptions: journeyStepForm.multipleChoiceOptions.length > 0 ? JSON.stringify(journeyStepForm.multipleChoiceOptions) : null,
      isConditional: journeyStepForm.isConditional ? "true" : "false",
    };
    try {
      if (editingJourneyStep) {
        await apiRequest("PUT", `/api/super-admin/account-groups/${groupId}/group-journeys/${selectedGroupJourney.id}/steps/${editingJourneyStep.id}`, stepData);
        toast({ title: "Step updated" });
      } else {
        const maxOrder = selectedGroupJourney.steps?.length || 0;
        await apiRequest("POST", `/api/super-admin/account-groups/${groupId}/group-journeys/${selectedGroupJourney.id}/steps`, { ...stepData, stepOrder: String(maxOrder + 1) });
        toast({ title: "Step added" });
      }
      setJourneyStepDialogOpen(false);
      setEditingJourneyStep(null);
      resetJourneyStepForm();
      fetchGroupJourneyWithSteps(selectedGroupJourney.id);
    } catch (error) {
      toast({ title: "Failed to save step", variant: "destructive" });
    }
  };

  const handleDeleteJourneyStep = async (stepId: string) => {
    if (!groupId || !selectedGroupJourney) return;
    try {
      await apiRequest("DELETE", `/api/super-admin/account-groups/${groupId}/group-journeys/${selectedGroupJourney.id}/steps/${stepId}`);
      toast({ title: "Step deleted" });
      fetchGroupJourneyWithSteps(selectedGroupJourney.id);
    } catch (error) {
      toast({ title: "Failed to delete step", variant: "destructive" });
    }
  };

  const handleJourneyDragStart = (stepId: string) => setJourneyDraggedStepId(stepId);

  const handleJourneyDragOver = (e: React.DragEvent, targetStepId: string) => {
    e.preventDefault();
    if (!journeyDraggedStepId || !selectedGroupJourney?.steps) return;
    const steps = [...selectedGroupJourney.steps];
    const draggedIndex = steps.findIndex((s: any) => s.id === journeyDraggedStepId);
    const targetIndex = steps.findIndex((s: any) => s.id === targetStepId);
    if (draggedIndex === targetIndex) return;
    const [draggedStep] = steps.splice(draggedIndex, 1);
    steps.splice(targetIndex, 0, draggedStep);
    setSelectedGroupJourney((prev: any) => prev ? { ...prev, steps: steps.map((s: any, i: number) => ({ ...s, stepOrder: i + 1 })) } : prev);
  };

  const handleJourneyDragEnd = async () => {
    if (!journeyDraggedStepId || !selectedGroupJourney?.steps || !groupId) return;
    const stepOrders = selectedGroupJourney.steps.map((step: any) => ({ id: step.id, stepOrder: step.stepOrder }));
    try {
      await apiRequest("POST", `/api/super-admin/account-groups/${groupId}/group-journeys/${selectedGroupJourney.id}/steps/reorder`, { stepOrders });
    } catch (error) {
      console.error("Failed to reorder steps:", error);
      fetchGroupJourneyWithSteps(selectedGroupJourney.id);
    }
    setJourneyDraggedStepId(null);
  };

  const handlePublishJourneys = async () => {
    if (!groupId) return;
    setPublishingJourneys(true);
    try {
      const result = await apiRequest("POST", `/api/super-admin/account-groups/${groupId}/group-journeys/publish`);
      toast({ title: result.message || "Journeys published to all member accounts" });
    } catch (error) {
      toast({ title: "Failed to publish journeys", variant: "destructive" });
    } finally {
      setPublishingJourneys(false);
    }
  };

  const fetchExtraSettings = async () => {
    if (!groupId) return;
    try {
      const data = await apiRequest("GET", `/api/super-admin/account-groups/${groupId}/extra-settings`);
      setExtraResponseLength(data.responseLength || "balanced");
      setExtraAutoOpenChat(data.autoOpenChat || "false");
      setExtraOpeningSoundEnabled(data.openingSoundEnabled !== "false");
      setExtraOpeningSoundStyle(data.openingSoundStyle || "chime");
      setExtraInactivityNudgeEnabled(data.inactivityNudgeEnabled !== "false");
      setExtraInactivityNudgeDelay(data.inactivityNudgeDelay || "45");
      setExtraInactivityNudgeMessage(data.inactivityNudgeMessage || "Still there? Let me know if you need any help!");
      setExtraSmartNudgeEnabled(data.smartNudgeEnabled === "true");
      setExtraLoaded(true);
    } catch (error) {
      console.error("Error fetching extra settings:", error);
    }
  };

  useEffect(() => {
    if (activeTab === "extra" && !extraLoaded && groupId) {
      fetchExtraSettings();
    }
  }, [activeTab, groupId, extraLoaded]);

  const handleSaveExtraSettings = async () => {
    if (!groupId) return;
    setSavingExtra(true);
    try {
      await apiRequest("PUT", `/api/super-admin/account-groups/${groupId}/extra-settings`, {
        responseLength: extraResponseLength,
        autoOpenChat: extraAutoOpenChat,
        openingSoundEnabled: extraOpeningSoundEnabled ? "true" : "false",
        openingSoundStyle: extraOpeningSoundStyle,
        inactivityNudgeEnabled: extraInactivityNudgeEnabled ? "true" : "false",
        inactivityNudgeDelay: extraInactivityNudgeDelay,
        inactivityNudgeMessage: extraInactivityNudgeMessage,
        smartNudgeEnabled: extraSmartNudgeEnabled ? "true" : "false",
      });
      toast({ title: "Extra settings saved" });
    } catch (error) {
      toast({ title: "Failed to save extra settings", variant: "destructive" });
    } finally {
      setSavingExtra(false);
    }
  };

  const handlePublishExtraSettings = async () => {
    if (!groupId) return;
    setPublishingExtra(true);
    try {
      await handleSaveExtraSettings();
      const result = await apiRequest("POST", `/api/super-admin/account-groups/${groupId}/extra-settings/publish`);
      toast({ title: result.message || "Extra settings published to all member accounts" });
    } catch (error) {
      toast({ title: "Failed to publish extra settings", variant: "destructive" });
    } finally {
      setPublishingExtra(false);
    }
  };

  const hasFallbackInstruction = instructions.some(instr => instr.type === 'fallback');
  
  const createDisabledLeadConfig = (): LeadTrainingConfig => ({
    captureStrategy: 'smart',
    fields: DEFAULT_LEAD_CONFIG.fields.map(f => ({ ...f, enabled: false })),
  });
  
  const applyFormatting = (type: 'bold' | 'italic', isEdit: boolean = false) => {
    const textarea = isEdit ? editTextareaRef.current : textareaRef.current;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = isEdit ? editText : newInstruction;
    const selectedText = text.substring(start, end);
    const marker = type === 'bold' ? '**' : '*';
    
    let newText: string;
    let newCursorPos: number;
    
    if (selectedText) {
      newText = text.substring(0, start) + marker + selectedText + marker + text.substring(end);
      newCursorPos = end + marker.length * 2;
    } else {
      newText = text.substring(0, start) + marker + marker + text.substring(end);
      newCursorPos = start + marker.length;
    }
    
    if (isEdit) {
      setEditText(newText);
    } else {
      setNewInstruction(newText);
    }
    
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };
  
  const handleAddInstruction = () => {
    if (!newInstruction.trim()) return;
    
    if (newInstructionType === 'conditional' && newKeywords.length === 0) {
      toast({
        title: "Keywords Required",
        description: "Please add at least one trigger keyword for conditional instructions.",
        variant: "destructive",
      });
      return;
    }
    
    if (newInstructionType === 'fallback' && hasFallbackInstruction) {
      toast({
        title: "Only One Fallback Allowed",
        description: "Please edit or delete the existing fallback template before adding a new one.",
        variant: "destructive",
      });
      return;
    }
    
    const newInstr: Instruction = {
      id: Date.now().toString(),
      text: newInstruction.trim(),
      type: newInstructionType,
      keywords: newInstructionType === 'conditional' ? newKeywords : undefined,
    };
    
    setInstructions([...instructions, newInstr]);
    setNewInstruction("");
    setNewInstructionType('always');
    setNewKeywords([]);
    setKeywordInput("");
    setHasChanges(true);
  };
  
  const handleDeleteClick = (id: string) => {
    setInstructionToDelete(id);
    setDeleteDialogOpen(true);
  };
  
  const handleConfirmDelete = () => {
    if (instructionToDelete) {
      setInstructions(instructions.filter(instr => instr.id !== instructionToDelete));
      setHasChanges(true);
    }
    setDeleteDialogOpen(false);
    setInstructionToDelete(null);
  };
  
  const handleStartEdit = (instruction: Instruction) => {
    setEditingId(instruction.id);
    setEditText(instruction.text);
    setEditDialogOpen(true);
  };
  
  const handleSaveEdit = () => {
    if (!editText.trim() || !editingId) return;
    
    setInstructions(instructions.map(instr => 
      instr.id === editingId 
        ? { ...instr, text: editText.trim() }
        : instr
    ));
    
    setEditDialogOpen(false);
    setEditingId(null);
    setEditText("");
    setHasChanges(true);
  };
  
  const handleRefineWithAI = async () => {
    if (!newInstruction.trim()) return;
    
    setIsRefining(true);
    setOriginalInstruction(newInstruction);
    
    try {
      const response = await fetch('/api/ai/refine-instruction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ instruction: newInstruction.trim() })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to refine instruction');
      }
      
      const data = await response.json();
      setRefinedInstruction(data.refined);
      setRefineDialogOpen(true);
    } catch (error: any) {
      toast({
        title: "Refinement Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRefining(false);
    }
  };
  
  const handleAcceptRefined = () => {
    if (refiningExistingId) {
      setInstructions(instructions.map(instr =>
        instr.id === refiningExistingId
          ? { ...instr, text: refinedInstruction }
          : instr
      ));
      setRefiningExistingId(null);
    } else {
      setNewInstruction(refinedInstruction);
    }
    setRefineDialogOpen(false);
    setRefinedInstruction("");
    setOriginalInstruction("");
    setHasChanges(true);
  };
  
  const handleFieldToggle = (fieldId: string) => {
    setLeadTrainingConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, enabled: !f.enabled } : f)
    }));
    setHasChanges(true);
  };
  
  const handleRequiredToggle = (fieldId: string) => {
    setLeadTrainingConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, required: !f.required } : f)
    }));
    setHasChanges(true);
  };
  
  const handleStrategyChange = (fieldId: string, strategy: 'smart' | 'start' | 'end' | 'intent') => {
    setLeadTrainingConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, captureStrategy: strategy } : f)
    }));
    setHasChanges(true);
  };
  
  const handlePhoneValidationChange = (fieldId: string, validation: PhoneValidation) => {
    setLeadTrainingConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === fieldId ? { ...f, phoneValidation: validation } : f)
    }));
    setHasChanges(true);
  };
  
  const handleMoveFieldUp = (fieldId: string) => {
    const sortedFields = [...leadTrainingConfig.fields].sort((a, b) => a.priority - b.priority);
    const index = sortedFields.findIndex(f => f.id === fieldId);
    if (index <= 0) return;
    
    const currentPriority = sortedFields[index].priority;
    const abovePriority = sortedFields[index - 1].priority;
    
    setLeadTrainingConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id === fieldId) return { ...f, priority: abovePriority };
        if (f.id === sortedFields[index - 1].id) return { ...f, priority: currentPriority };
        return f;
      })
    }));
    setHasChanges(true);
  };
  
  const handleMoveFieldDown = (fieldId: string) => {
    const sortedFields = [...leadTrainingConfig.fields].sort((a, b) => a.priority - b.priority);
    const index = sortedFields.findIndex(f => f.id === fieldId);
    if (index >= sortedFields.length - 1) return;
    
    const currentPriority = sortedFields[index].priority;
    const belowPriority = sortedFields[index + 1].priority;
    
    setLeadTrainingConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id === fieldId) return { ...f, priority: belowPriority };
        if (f.id === sortedFields[index + 1].id) return { ...f, priority: currentPriority };
        return f;
      })
    }));
    setHasChanges(true);
  };
  
  const saveMutation = useMutation({
    mutationFn: async () => {
      const leadConfig = leadConfigEnabled ? leadTrainingConfig : createDisabledLeadConfig();
      const customInstructionsJson = instructions.length > 0 ? JSON.stringify(instructions) : null;
      
      const menuConfig = {
        enabled: menuEnabled ? "true" : "false",
        welcomeMessage: menuWelcomeMessage || null,
        avatarUrl: menuAvatarUrl || null,
        quickChips: menuQuickChips,
        footerText: menuFooterText || null,
        footerLinkText: menuFooterLinkText || null,
        footerLinkUrl: menuFooterLinkUrl || null,
        persistentCtaEnabled: menuPersistentCtaEnabled ? "true" : "false",
        persistentCtaLabel: menuPersistentCtaLabel || null,
        persistentCtaIcon: menuPersistentCtaIcon || null,
        persistentCtaAction: menuPersistentCtaAction || null,
        persistentCtaValue: menuPersistentCtaValue || null,
        leadFormFields: stringifyLeadFormFields(menuLeadFormFields),
      };
      
      return await apiRequest("PUT", `/api/super-admin/account-groups/${groupId}/training`, {
        customInstructions: customInstructionsJson,
        leadTrainingConfig: leadConfig,
        fallbackTemplate: null,
        menuConfig,
        menuItems,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/super-admin/account-groups/${groupId}/training`] });
      setHasChanges(false);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      toast({
        title: "Draft Saved",
        description: "Group training configuration has been saved as a draft.",
      });
    },
    onError: (error: Error) => {
      setSaveStatus("idle");
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const moduleLabels: Record<string, string> = {
    instructions: 'Instructions',
    leadTraining: 'Lead Training',
    leadsquared: 'LeadSquared',
    menuBuilder: 'Menu Builder',
  };

  const publishMutation = useMutation({
    mutationFn: async (moduleToPublish?: string) => {
      const leadConfig = leadConfigEnabled ? leadTrainingConfig : createDisabledLeadConfig();
      const customInstructionsJson = instructions.length > 0 ? JSON.stringify(instructions) : null;
      
      const menuConfig = {
        enabled: menuEnabled ? "true" : "false",
        welcomeMessage: menuWelcomeMessage || null,
        avatarUrl: menuAvatarUrl || null,
        quickChips: menuQuickChips,
        footerText: menuFooterText || null,
        footerLinkText: menuFooterLinkText || null,
        footerLinkUrl: menuFooterLinkUrl || null,
        persistentCtaEnabled: menuPersistentCtaEnabled ? "true" : "false",
        persistentCtaLabel: menuPersistentCtaLabel || null,
        persistentCtaIcon: menuPersistentCtaIcon || null,
        persistentCtaAction: menuPersistentCtaAction || null,
        persistentCtaValue: menuPersistentCtaValue || null,
        leadFormFields: stringifyLeadFormFields(menuLeadFormFields),
      };
      
      if (hasChanges) {
        await apiRequest("PUT", `/api/super-admin/account-groups/${groupId}/training`, {
          customInstructions: customInstructionsJson,
          leadTrainingConfig: leadConfig,
          fallbackTemplate: null,
          menuConfig,
          menuItems,
        });
      }
      const publishResult = await apiRequest("POST", `/api/super-admin/account-groups/${groupId}/training/publish`, { module: moduleToPublish });
      
      if (moduleToPublish === 'leadsquared' && lsqEnabled && lsqHost) {
        await apiRequest("POST", `/api/super-admin/account-groups/${groupId}/leadsquared/apply`);
      }
      
      return publishResult;
    },
    onSuccess: (data: any, moduleToPublish?: string) => {
      queryClient.invalidateQueries({ queryKey: [`/api/super-admin/account-groups/${groupId}/training`] });
      setHasChanges(false);
      setPublishDialogOpen(null);
      const moduleName = moduleToPublish ? moduleLabels[moduleToPublish] || moduleToPublish : 'Training';
      const lsqNote = (moduleToPublish === 'leadsquared' && lsqEnabled && lsqHost) ? ' LeadSquared settings also applied.' : '';
      toast({
        title: `${moduleName} Published`,
        description: (data.message || `${moduleName} configuration pushed to all member accounts.`) + lsqNote,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Publish Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  const handleSave = () => {
    setSaveStatus("saving");
    saveMutation.mutate();
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <SidebarTrigger />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/super-admin/account-groups")}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Groups
            </Button>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-purple-600" />
              <h1 className="font-semibold">Group Training: {groupTraining?.groupName || "Loading..."}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saveStatus !== "idle" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
                {saveStatus === "saving" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 text-green-600" />
                    <span className="text-green-600">Saved</span>
                  </>
                )}
              </div>
            )}
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Draft
            </Button>
          </div>
        </div>
      </header>
      
      <main className="container max-w-4xl py-6">
        {groupTraining?.training?.lastPublishedAt && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
            <Check className="w-4 h-4" />
            Last published: {new Date(groupTraining.training.lastPublishedAt).toLocaleString()}
          </div>
        )}
        
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-lg">
            <GraduationCap className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Train Chroney</h1>
            <p className="text-muted-foreground">Teach your AI assistant how to respond to customers</p>
          </div>
        </div>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full h-auto p-0 bg-transparent border-b border-gray-200 dark:border-gray-800 rounded-none gap-0 justify-start mb-6">
            <TabsTrigger 
              value="instructions" 
              className="gap-2 px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-purple-600 data-[state=active]:bg-purple-50 dark:data-[state=active]:bg-purple-950/30 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-400 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 data-[state=active]:shadow-none"
            >
              <Brain className="w-4 h-4" />
              Instructions
            </TabsTrigger>
            <TabsTrigger 
              value="lead-training" 
              className="gap-2 px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-purple-600 data-[state=active]:bg-purple-50 dark:data-[state=active]:bg-purple-950/30 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-400 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 data-[state=active]:shadow-none"
            >
              <UserCheck className="w-4 h-4" />
              Lead Training
            </TabsTrigger>
            <TabsTrigger 
              value="leadsquared" 
              className="gap-2 px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-purple-600 data-[state=active]:bg-purple-50 dark:data-[state=active]:bg-purple-950/30 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-400 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 data-[state=active]:shadow-none"
            >
              <Link2 className="w-4 h-4" />
              LeadSquared
            </TabsTrigger>
            <TabsTrigger 
              value="journey-training" 
              className="gap-2 px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-purple-600 data-[state=active]:bg-purple-50 dark:data-[state=active]:bg-purple-950/30 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-400 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 data-[state=active]:shadow-none"
            >
              <Route className="w-4 h-4" />
              Journey Training
            </TabsTrigger>
            <TabsTrigger 
              value="menu-builder" 
              className="gap-2 px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-purple-600 data-[state=active]:bg-purple-50 dark:data-[state=active]:bg-purple-950/30 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-400 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 data-[state=active]:shadow-none"
            >
              <Menu className="w-4 h-4" />
              Menu Builder
            </TabsTrigger>
            <TabsTrigger 
              value="extra" 
              className="gap-2 px-6 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-purple-600 data-[state=active]:bg-purple-50 dark:data-[state=active]:bg-purple-950/30 data-[state=active]:text-purple-700 dark:data-[state=active]:text-purple-400 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 data-[state=active]:shadow-none"
            >
              <Settings className="w-4 h-4" />
              Extra
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="instructions" className="space-y-6">
            {/* Add New Instruction Card */}
            <Card className="shadow-sm">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  {/* Instruction Type Selector */}
                  <div className="space-y-3">
                    <label className="text-sm font-medium block">Instruction Type</label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={newInstructionType === 'always' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          setNewInstructionType('always');
                          setNewKeywords([]);
                          setKeywordInput("");
                        }}
                        className={`gap-1.5 ${newInstructionType === 'always' ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700' : ''}`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Always Active
                      </Button>
                      <Button
                        type="button"
                        variant={newInstructionType === 'conditional' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setNewInstructionType('conditional')}
                        className={`gap-1.5 ${newInstructionType === 'conditional' ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600' : ''}`}
                      >
                        <Route className="w-3.5 h-3.5" />
                        Conditional
                      </Button>
                      <Button
                        type="button"
                        variant={newInstructionType === 'fallback' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          setNewInstructionType('fallback');
                          setNewKeywords([]);
                          setKeywordInput("");
                        }}
                        className={`gap-1.5 ${newInstructionType === 'fallback' ? 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600' : ''}`}
                      >
                        <AlertCircle className="w-3.5 h-3.5" />
                        Fallback
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {newInstructionType === 'always' 
                        ? 'This instruction will apply to every response.' 
                        : newInstructionType === 'conditional'
                        ? 'This instruction will only trigger when the user mentions specific keywords.'
                        : 'Add a fallback response template below. This exact message will be shown to customers when the AI cannot find an answer in your knowledge base.'}
                    </p>
                  </div>
                  
                  {/* Placeholder Guide for Fallback Templates */}
                  {newInstructionType === 'fallback' && !hasFallbackInstruction && (
                    <div className="space-y-3 p-4 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-900/30">
                      <label className="text-sm font-medium block text-blue-900 dark:text-blue-200">
                        Smart Placeholders (Optional)
                      </label>
                      <p className="text-xs text-blue-700 dark:text-blue-400">
                        Use these placeholders to show different messages based on whether contact info is already collected:
                      </p>
                      <div className="space-y-2 text-xs font-mono bg-white dark:bg-gray-900 p-3 rounded border border-blue-200 dark:border-blue-800">
                        <div className="text-blue-600 dark:text-blue-400">
                          {"{{if_missing_phone}}"}...{"{{/if_missing_phone}}"} <span className="text-gray-500 font-sans">- Shows only if no phone collected</span>
                        </div>
                        <div className="text-green-600 dark:text-green-400">
                          {"{{if_has_phone}}"}...{"{{/if_has_phone}}"} <span className="text-gray-500 font-sans">- Shows only if phone is already collected</span>
                        </div>
                        <div className="text-gray-500 font-sans mt-2">Also available: <span className="font-mono text-gray-600">email</span>, <span className="font-mono text-gray-600">name</span>, <span className="font-mono text-gray-600">mobile</span></div>
                      </div>
                      
                      {/* Sample Templates */}
                      <div className="pt-3 border-t border-blue-200 dark:border-blue-800">
                        <label className="text-sm font-medium block text-blue-900 dark:text-blue-200 mb-2">
                          Quick Templates (click to use)
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setNewInstruction(`I don't have specific information about that. {{if_missing_phone}}Please share your phone number so our team can assist you personally.{{/if_missing_phone}}{{if_has_phone}}Our team will contact you shortly to help with your inquiry.{{/if_has_phone}}`)}
                            className="p-2.5 text-left rounded-lg border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Phone className="w-3.5 h-3.5 text-blue-600" />
                              <span className="text-xs font-medium">Contact Request</span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              Asks for phone if not collected
                            </p>
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => setNewInstruction(`I'm not able to find that specific information. {{if_missing_email}}Could you share your email address? I'll have our team send you the details directly.{{/if_missing_email}}{{if_has_email}}I'll have our team follow up with you via email with more details.{{/if_has_email}}`)}
                            className="p-2.5 text-left rounded-lg border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Mail className="w-3.5 h-3.5 text-blue-600" />
                              <span className="text-xs font-medium">Email Follow-up</span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              Requests email for follow-up
                            </p>
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => setNewInstruction(`I don't have that information readily available. {{if_missing_name}}May I know your name so I can have someone from our team reach out to you?{{/if_missing_name}}{{if_has_name}}Let me connect you with a team member who can help.{{/if_has_name}} {{if_missing_phone}}Please share your phone number and we'll get back to you shortly.{{/if_missing_phone}}`)}
                            className="p-2.5 text-left rounded-lg border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <User className="w-3.5 h-3.5 text-blue-600" />
                              <span className="text-xs font-medium">Personal Touch</span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              Uses name with phone request
                            </p>
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => setNewInstruction(`I apologize, but I don't have detailed information on that topic. For the most accurate answer, I recommend speaking with our team directly. {{if_missing_phone}}Please share your contact number and we'll call you back within 24 hours.{{/if_missing_phone}}{{if_has_phone}}Our team will reach out to you soon with the details.{{/if_has_phone}}`)}
                            className="p-2.5 text-left rounded-lg border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                              <span className="text-xs font-medium">Professional Handoff</span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1">
                              Professional apology with callback
                            </p>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Keyword Input for Conditional */}
                  {newInstructionType === 'conditional' && (
                    <div className="space-y-3 p-4 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-900/30">
                      <label className="text-sm font-medium block text-amber-900 dark:text-amber-200">
                        Trigger Keywords
                      </label>
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Add keywords that will trigger this instruction. The AI will only apply this instruction when the user's message contains one of these keywords.
                      </p>
                      <div className="flex gap-2">
                        <Input
                          value={keywordInput}
                          onChange={(e) => setKeywordInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && keywordInput.trim()) {
                              e.preventDefault();
                              if (!newKeywords.includes(keywordInput.trim().toLowerCase())) {
                                setNewKeywords([...newKeywords, keywordInput.trim().toLowerCase()]);
                              }
                              setKeywordInput("");
                            }
                          }}
                          placeholder="Type a keyword and press Enter..."
                          className="flex-1 bg-white dark:bg-gray-900"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (keywordInput.trim() && !newKeywords.includes(keywordInput.trim().toLowerCase())) {
                              setNewKeywords([...newKeywords, keywordInput.trim().toLowerCase()]);
                              setKeywordInput("");
                            }
                          }}
                          disabled={!keywordInput.trim()}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      {newKeywords.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {newKeywords.map((keyword, index) => (
                            <span
                              key={index}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-xs font-medium rounded-full"
                            >
                              {keyword}
                              <button
                                type="button"
                                onClick={() => setNewKeywords(newKeywords.filter((_, i) => i !== index))}
                                className="hover:text-amber-600 dark:hover:text-amber-300"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {newKeywords.length === 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Add at least one keyword to create a conditional instruction
                        </p>
                      )}
                    </div>
                  )}
                  
                  {/* Show message when fallback already exists */}
                  {newInstructionType === 'fallback' && hasFallbackInstruction ? (
                    <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                      <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                        <AlertCircle className="w-4 h-4" />
                        <p className="text-sm font-medium">You already have a fallback template</p>
                      </div>
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                        Only one fallback template is allowed. To change it, delete the existing one below and add a new one.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="text-sm font-medium mb-3 block">
                          {newInstructionType === 'fallback' ? 'Fallback Response Template' : 'New Instruction'}
                        </label>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-t-lg border border-b-0">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => applyFormatting('bold')}
                                    className="h-7 w-7 p-0"
                                  >
                                    <Bold className="w-3.5 h-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Bold</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => applyFormatting('italic')}
                                    className="h-7 w-7 p-0"
                                  >
                                    <Italic className="w-3.5 h-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Italic</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <span className="text-xs text-muted-foreground ml-1">Select text to format</span>
                          </div>
                          <Textarea
                            ref={textareaRef}
                            value={newInstruction}
                            onChange={(e) => setNewInstruction(e.target.value)}
                            placeholder="Type your instruction in plain English..."
                            className="min-h-[120px] rounded-t-none border-t-0"
                          />
                        </div>
                      </div>
                      
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={handleRefineWithAI}
                          disabled={!newInstruction.trim() || isRefining}
                        >
                          {isRefining ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4 mr-2 text-purple-500" />
                          )}
                          Refine with AI
                        </Button>
                        <Button
                          onClick={handleAddInstruction}
                          disabled={!newInstruction.trim() || (newInstructionType === 'conditional' && newKeywords.length === 0)}
                          className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Add Instruction
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
            
            {/* Instructions List */}
            <Card className="shadow-sm bg-gray-50/50 dark:bg-gray-900/30">
              <CardContent className="pt-6">
                {instructions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-4">
                      <Brain className="w-8 h-8 text-purple-600 dark:text-purple-400" />
                    </div>
                    <h3 className="text-lg font-medium mb-2">No instructions yet</h3>
                    <p className="text-sm text-muted-foreground max-w-sm">
                      Add your first instruction above to start training Chroney on how to respond to your customers.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {instructions.map((instruction) => (
                      <div
                        key={instruction.id}
                        className={`p-4 rounded-lg border ${
                          instruction.type === 'always' 
                            ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800' 
                            : instruction.type === 'conditional'
                            ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
                            : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              {instruction.type === 'always' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-full text-xs font-medium">
                                  <Check className="w-3 h-3" />
                                  Always Active
                                </span>
                              )}
                              {instruction.type === 'conditional' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded-full text-xs font-medium">
                                  <Route className="w-3 h-3" />
                                  Conditional
                                </span>
                              )}
                              {instruction.type === 'fallback' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full text-xs font-medium">
                                  <AlertCircle className="w-3 h-3" />
                                  Fallback
                                </span>
                              )}
                              {/* Sync status indicator - based on published vs updated timestamps */}
                              {(() => {
                                const training = groupTraining?.training;
                                const lastPublished = training?.lastPublishedAt ? new Date(training.lastPublishedAt) : null;
                                const lastUpdated = training?.updatedAt ? new Date(training.updatedAt) : null;
                                
                                // Synced = published after last update OR local changes pending
                                const isSynced = lastPublished && lastUpdated && lastPublished >= lastUpdated && !hasChanges;
                                
                                if (isSynced && groupTraining?.memberCount) {
                                  return (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">
                                            <CheckCircle2 className="w-3 h-3" />
                                            <Users className="w-3 h-3" />
                                            {groupTraining.memberCount}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>Synced to {groupTraining.memberCount} accounts</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  );
                                } else {
                                  return (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 rounded-full text-xs font-medium">
                                            <Clock className="w-3 h-3" />
                                            Pending
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>Publish to sync to {groupTraining?.memberCount || 0} accounts</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  );
                                }
                              })()}
                            </div>
                            {instruction.keywords && instruction.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {instruction.keywords.map(kw => (
                                  <span key={kw} className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded text-xs">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            )}
                            <p className="text-sm">{renderFormattedText(instruction.text)}</p>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => handleStartEdit(instruction)} className="h-8 w-8 p-0">
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDeleteClick(instruction.id)} className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <div className="flex justify-end pt-4">
              <Button
                onClick={() => setPublishDialogOpen('instructions')}
                disabled={publishMutation.isPending}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Publish Instructions to All Accounts
              </Button>
            </div>
          </TabsContent>
          
          <TabsContent value="lead-training" className="space-y-6">
            <Card className="shadow-sm bg-gradient-to-br from-green-50/50 via-emerald-50/30 to-teal-50/50 dark:from-green-950/20 dark:via-emerald-950/10 dark:to-teal-950/20 border-green-200 dark:border-green-900/30">
              <CardHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-600 flex items-center justify-center shadow-lg">
                    <UserCheck className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Smart Lead Training</CardTitle>
                    <CardDescription className="mt-1">
                      Configure which contact information Chroney should collect
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-lg border">
                  <div>
                    <Label className="font-medium">Enable Lead Collection</Label>
                    <p className="text-sm text-muted-foreground">Allow AI to collect visitor contact information</p>
                  </div>
                  <Button
                    variant={leadConfigEnabled ? "default" : "outline"}
                    onClick={() => {
                      setLeadConfigEnabled(!leadConfigEnabled);
                      setHasChanges(true);
                    }}
                    className={leadConfigEnabled ? "bg-green-600 hover:bg-green-700" : ""}
                  >
                    {leadConfigEnabled ? (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Enabled
                      </>
                    ) : (
                      "Disabled"
                    )}
                  </Button>
                </div>
                
                {leadConfigEnabled && (
                  <div className="space-y-3">
                    {[...leadTrainingConfig.fields].sort((a, b) => a.priority - b.priority).map((field, index, sortedArray) => (
                      <div 
                        key={field.id}
                        className={`rounded-lg border transition-all duration-200 ${
                          field.enabled
                            ? 'bg-white dark:bg-gray-900 border-green-200 dark:border-green-900/50'
                            : 'bg-gray-50/50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800'
                        }`}
                      >
                        <div className="flex items-center gap-3 p-3">
                          <div className="flex flex-col gap-0.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleMoveFieldUp(field.id)}
                              disabled={index === 0}
                              className="h-5 w-5 p-0 hover:bg-green-50 dark:hover:bg-green-950/20 disabled:opacity-30"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleMoveFieldDown(field.id)}
                              disabled={index === sortedArray.length - 1}
                              className="h-5 w-5 p-0 hover:bg-green-50 dark:hover:bg-green-950/20 disabled:opacity-30"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </Button>
                          </div>

                          <input
                            type="checkbox"
                            id={`field-check-${field.id}`}
                            checked={field.enabled}
                            onChange={() => handleFieldToggle(field.id)}
                            className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                          />

                          <div className={`transition-all duration-200 ${field.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                            {getFieldIcon(field.id)}
                          </div>

                          <Label
                            htmlFor={`field-check-${field.id}`}
                            className={`flex-1 text-sm font-medium cursor-pointer transition-all duration-200 ${
                              field.enabled ? 'text-foreground' : 'text-muted-foreground'
                            }`}
                          >
                            {getFieldLabel(field.id)}
                          </Label>

                          {field.enabled && (
                            <div className="flex items-center gap-1 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
                              <button
                                onClick={() => {
                                  if (!field.required) handleRequiredToggle(field.id);
                                }}
                                className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-all duration-200 ${
                                  field.required
                                    ? 'bg-purple-600 text-white shadow-sm'
                                    : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                              >
                                {field.required && <Check className="w-3 h-3" />}
                                Mandatory
                              </button>
                              <button
                                onClick={() => {
                                  if (field.required) handleRequiredToggle(field.id);
                                }}
                                className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-all duration-200 ${
                                  !field.required
                                    ? 'bg-gray-600 text-white shadow-sm dark:bg-gray-500'
                                    : 'bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                              >
                                {!field.required && <Check className="w-3 h-3" />}
                                Optional
                              </button>
                            </div>
                          )}
                          
                          {field.enabled && (field.id === 'mobile' || field.id === 'whatsapp') && (
                            <Select
                              value={field.phoneValidation || '10'}
                              onValueChange={(value) => handlePhoneValidationChange(field.id, value as PhoneValidation)}
                            >
                              <SelectTrigger className="h-7 w-[100px] text-xs">
                                <SelectValue placeholder="Validation" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="10">10 digits</SelectItem>
                                <SelectItem value="12">12 digits</SelectItem>
                                <SelectItem value="8-12">8-12 digits</SelectItem>
                                <SelectItem value="any">Any length</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>

                        {field.enabled && (
                          <div className="px-3 pb-3 pt-0">
                            <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50">
                              <div className="flex items-center gap-2 mb-2">
                                <Route className="w-3.5 h-3.5 text-muted-foreground" />
                                <span className="text-xs font-medium text-muted-foreground">When to collect</span>
                              </div>
                              <RadioGroup
                                value={field.captureStrategy}
                                onValueChange={(value) => handleStrategyChange(field.id, value as 'smart' | 'start' | 'end' | 'intent')}
                                className="flex flex-wrap gap-3"
                              >
                                <div className="flex items-center space-x-1.5">
                                  <RadioGroupItem value="start" id={`timing-start-${field.id}`} className="h-3.5 w-3.5" />
                                  <Label htmlFor={`timing-start-${field.id}`} className="text-xs cursor-pointer">At Start</Label>
                                </div>
                                <div className="flex items-center space-x-1.5">
                                  <RadioGroupItem value="smart" id={`timing-smart-${field.id}`} className="h-3.5 w-3.5" />
                                  <Label htmlFor={`timing-smart-${field.id}`} className="text-xs cursor-pointer">Smart</Label>
                                </div>
                                <div className="flex items-center space-x-1.5">
                                  <RadioGroupItem value="intent" id={`timing-intent-${field.id}`} className="h-3.5 w-3.5" />
                                  <Label htmlFor={`timing-intent-${field.id}`} className="text-xs cursor-pointer">Intent</Label>
                                </div>
                                <div className="flex items-center space-x-1.5">
                                  <RadioGroupItem value="end" id={`timing-end-${field.id}`} className="h-3.5 w-3.5" />
                                  <Label htmlFor={`timing-end-${field.id}`} className="text-xs cursor-pointer">At End</Label>
                                </div>
                              </RadioGroup>
                              {field.captureStrategy === 'start' && (
                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 italic">
                                  AI will ask immediately at the start of the conversation
                                </p>
                              )}
                              {field.captureStrategy === 'smart' && (
                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 italic">
                                  AI will ask in the 2nd response (after answering the first question)
                                </p>
                              )}
                              {field.captureStrategy === 'intent' && (
                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 italic">
                                  AI will ask when user shows interest (e.g., asking about price, availability)
                                </p>
                              )}
                              {field.captureStrategy === 'end' && (
                                <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 italic">
                                  AI will ask at the end of the conversation
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <ChevronUp className="w-3 h-3" />
                      <ChevronDown className="w-3 h-3" />
                      <span>Use arrows to set collection priority</span>
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            <div className="flex justify-end pt-4">
              <Button
                onClick={() => setPublishDialogOpen('leadTraining')}
                disabled={publishMutation.isPending}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Publish Lead Training to All Accounts
              </Button>
            </div>
          </TabsContent>
          
          <TabsContent value="leadsquared" className="space-y-6">
            {/* LeadSquared Credentials Card */}
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="w-5 h-5 text-purple-600" />
                  LeadSquared Integration
                </CardTitle>
                <CardDescription>
                  Configure LeadSquared CRM credentials and field mappings for all accounts in this group.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Enable/Disable Switch */}
                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div>
                    <Label className="font-medium">Enable LeadSquared Sync</Label>
                    <p className="text-sm text-muted-foreground">
                      When enabled, leads captured by member accounts will sync to LeadSquared.
                    </p>
                  </div>
                  <Switch
                    checked={lsqEnabled}
                    onCheckedChange={setLsqEnabled}
                  />
                </div>
                
                {/* Credentials Form */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="lsq-host">LeadSquared Host URL</Label>
                    <Input
                      id="lsq-host"
                      placeholder="https://api-in21.leadsquared.com"
                      value={lsqHost}
                      onChange={(e) => setLsqHost(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Your LeadSquared API host URL (e.g., api-in21.leadsquared.com for India region)
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="lsq-access-key">Access Key</Label>
                    <Input
                      id="lsq-access-key"
                      placeholder="Enter your LeadSquared access key"
                      value={lsqAccessKey}
                      onChange={(e) => setLsqAccessKey(e.target.value)}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="lsq-secret-key">Secret Key</Label>
                    <div className="relative">
                      <Input
                        id="lsq-secret-key"
                        type={showLsqSecretKey ? "text" : "password"}
                        placeholder="Enter your LeadSquared secret key"
                        value={lsqSecretKey}
                        onChange={(e) => {
                          setLsqSecretKey(e.target.value);
                          setLsqSecretKeyChanged(true);
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                        onClick={() => setShowLsqSecretKey(!showLsqSecretKey)}
                      >
                        {showLsqSecretKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                  
                  <Button onClick={saveLsqSettings} disabled={savingLsq}>
                    {savingLsq ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    Save Credentials
                  </Button>
                </div>
              </CardContent>
            </Card>
            
            {/* Field Mappings Card */}
            <Card className="shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Field Mappings</CardTitle>
                    <CardDescription>
                      Configure how lead data maps to LeadSquared fields.
                    </CardDescription>
                  </div>
                  <Button
                    onClick={() => {
                      setEditingLsqMapping(null);
                      setNewLsqMapping({
                        leadsquaredField: '',
                        sourceType: 'dynamic',
                        sourceField: '',
                        customValue: '',
                        displayName: '',
                        fallbackValue: '',
                      });
                      setShowLsqMappingDialog(true);
                    }}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Mapping
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {loadingLsqMappings ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : lsqFieldMappings.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Link2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No field mappings configured yet.</p>
                    <p className="text-sm">Add mappings to sync lead data to LeadSquared.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {lsqFieldMappings.map((mapping) => (
                      <div
                        key={mapping.id}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          mapping.isEnabled ? 'bg-background' : 'bg-muted/50 opacity-60'
                        }`}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{mapping.displayName}</span>
                            <span className="text-xs px-2 py-0.5 rounded bg-muted">
                              {mapping.leadsquaredField}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {mapping.sourceType === 'dynamic' ? (
                              <>Source: {LSQ_DYNAMIC_SOURCE_OPTIONS.find(o => o.value === mapping.sourceField)?.label || mapping.sourceField}
                                {mapping.fallbackValue && (
                                  <span className="ml-1 text-gray-400">(fallback: "{mapping.fallbackValue}")</span>
                                )}
                              </>
                            ) : (
                              <>Static value: {mapping.customValue}</>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={mapping.isEnabled === true || mapping.isEnabled === "true"}
                            onCheckedChange={() => toggleLsqMappingEnabled(mapping)}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingLsqMapping(mapping);
                              setNewLsqMapping({
                                leadsquaredField: mapping.leadsquaredField,
                                sourceType: mapping.sourceType,
                                sourceField: mapping.sourceField || '',
                                customValue: mapping.customValue || '',
                                displayName: mapping.displayName,
                                fallbackValue: mapping.fallbackValue || '',
                              });
                              setShowLsqMappingDialog(true);
                            }}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              setDeletingLsqMappingId(mapping.id);
                              setShowLsqDeleteDialog(true);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <div className="flex justify-end pt-4">
              <Button
                onClick={() => setPublishDialogOpen('leadsquared')}
                disabled={publishMutation.isPending}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Publish LeadSquared to All Accounts
              </Button>
            </div>
          </TabsContent>
          
          <TabsContent value="journey-training" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Route className="w-5 h-5 text-purple-600" />
                  Journey Training
                </h2>
                <p className="text-sm text-muted-foreground">Create and manage conversation journeys for all group members</p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handlePublishJourneys}
                  disabled={publishingJourneys || groupJourneysList.length === 0}
                  variant="outline"
                  className="gap-2 border-green-300 hover:border-green-500 hover:bg-green-50"
                >
                  {publishingJourneys ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Publish to All Accounts
                </Button>
                <Button onClick={() => setShowJourneyTemplates(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  New Journey
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-2">
                <Card className="shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">Group Journeys</CardTitle>
                    <CardDescription>{groupJourneysList.length} journey{groupJourneysList.length !== 1 ? "s" : ""} created</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 max-h-[calc(100vh-350px)] overflow-y-auto">
                    {groupJourneysList.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Route className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">No journeys yet</p>
                        <p className="text-xs mt-1">Create one to get started</p>
                      </div>
                    ) : (
                      groupJourneysList.map((journey) => (
                        <div
                          key={journey.id}
                          className={`group relative p-4 rounded-xl cursor-pointer transition-all duration-200 ${
                            selectedGroupJourneyId === journey.id
                              ? "bg-purple-50 dark:bg-purple-950/30 shadow-md border-l-4 border-purple-500"
                              : "bg-white dark:bg-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800 hover:shadow-md border-l-4 border-transparent"
                          }`}
                          onClick={() => {
                            setSelectedGroupJourneyId(journey.id);
                            fetchGroupJourneyWithSteps(journey.id);
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className={`font-semibold text-sm truncate ${selectedGroupJourneyId === journey.id ? "text-purple-700 dark:text-purple-300" : ""}`}>
                                  {journey.name}
                                </h3>
                                {journey.status === 'active' ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                                ) : (
                                  <AlertCircle className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                )}
                              </div>
                              {journey.description && (
                                <p className="text-xs text-muted-foreground line-clamp-2">{journey.description}</p>
                              )}
                              <p className="text-xs text-muted-foreground mt-1">Type: {journey.journeyType || 'conversational'}</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="lg:col-span-3">
                {selectedGroupJourney ? (
                  <div className="space-y-4">
                    <Card className="shadow-sm">
                      <CardHeader className="space-y-4 pb-4">
                        <div>
                          {editingGroupJourneyName ? (
                            <div className="flex items-center gap-2">
                              <Input
                                value={editedGroupJourneyName}
                                onChange={(e) => setEditedGroupJourneyName(e.target.value)}
                                className="text-xl font-bold h-auto py-2"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && editedGroupJourneyName.trim()) {
                                    handleUpdateGroupJourney(selectedGroupJourney.id, { name: editedGroupJourneyName.trim() });
                                    setEditingGroupJourneyName(false);
                                  } else if (e.key === 'Escape') {
                                    setEditingGroupJourneyName(false);
                                  }
                                }}
                              />
                              <Button size="sm" onClick={() => { handleUpdateGroupJourney(selectedGroupJourney.id, { name: editedGroupJourneyName.trim() }); setEditingGroupJourneyName(false); }} className="bg-purple-600 hover:bg-purple-700"><Check className="w-4 h-4" /></Button>
                              <Button size="sm" variant="outline" onClick={() => setEditingGroupJourneyName(false)}><X className="w-4 h-4" /></Button>
                            </div>
                          ) : (
                            <div className="group flex items-center gap-2">
                              <h2 className="text-xl font-bold cursor-pointer hover:text-purple-600 transition-colors"
                                onClick={() => { setEditingGroupJourneyName(true); setEditedGroupJourneyName(selectedGroupJourney.name); }}
                              >{selectedGroupJourney.name}</h2>
                              <Edit2 className="w-4 h-4 text-muted-foreground opacity-50 group-hover:opacity-100" />
                            </div>
                          )}
                          {editingGroupJourneyDesc ? (
                            <div className="flex items-start gap-2 mt-2">
                              <Textarea value={editedGroupJourneyDesc} onChange={(e) => setEditedGroupJourneyDesc(e.target.value)} className="text-sm resize-none min-h-[50px]" autoFocus />
                              <Button size="sm" onClick={() => { handleUpdateGroupJourney(selectedGroupJourney.id, { description: editedGroupJourneyDesc.trim() }); setEditingGroupJourneyDesc(false); }} className="bg-purple-600 hover:bg-purple-700 h-8 w-8 p-0"><Check className="w-4 h-4" /></Button>
                              <Button size="sm" variant="outline" onClick={() => setEditingGroupJourneyDesc(false)} className="h-8 w-8 p-0"><X className="w-4 h-4" /></Button>
                            </div>
                          ) : (
                            <div className="group flex items-start gap-2 mt-1">
                              <p className="text-sm text-muted-foreground flex-1">{selectedGroupJourney.description || "No description"}</p>
                              <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 h-7 w-7 p-0 flex-shrink-0"
                                onClick={() => { setEditingGroupJourneyDesc(true); setEditedGroupJourneyDesc(selectedGroupJourney.description || ""); }}
                              ><Edit2 className="w-3.5 h-3.5" /></Button>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg">
                          <div>
                            <Label className="text-sm font-medium">Enable Journey</Label>
                            <p className="text-xs text-muted-foreground">Activate this journey for use</p>
                          </div>
                          <Switch
                            checked={selectedGroupJourney.status === 'active'}
                            onCheckedChange={(checked) => handleUpdateGroupJourney(selectedGroupJourney.id, { status: checked ? 'active' : 'inactive' })}
                            className="data-[state=checked]:bg-green-600"
                          />
                        </div>

                        <div className="flex items-center justify-between p-3 bg-orange-50/50 dark:bg-orange-950/10 rounded-lg border border-orange-200/50">
                          <div>
                            <Label className="text-sm font-medium">Start from Scratch</Label>
                            <p className="text-xs text-muted-foreground">Journey starts immediately - first step becomes the greeting</p>
                          </div>
                          <Switch
                            checked={selectedGroupJourney.startFromScratch === 'true'}
                            onCheckedChange={(checked) => handleUpdateGroupJourney(selectedGroupJourney.id, { startFromScratch: checked ? 'true' : 'false' })}
                            className="data-[state=checked]:bg-orange-600"
                          />
                        </div>

                        {selectedGroupJourney.startFromScratch !== 'true' && (
                          <div className="p-3 bg-purple-50/50 dark:bg-purple-950/10 rounded-lg border border-purple-200/50">
                            <Label className="text-sm font-medium">Trigger Keywords</Label>
                            <p className="text-xs text-muted-foreground mb-2">Auto-start this journey when users mention these keywords</p>
                            <div className="flex flex-wrap gap-2 mb-2">
                              {(() => {
                                let keywords: string[] = [];
                                try { keywords = selectedGroupJourney.triggerKeywords ? JSON.parse(selectedGroupJourney.triggerKeywords) : []; } catch {}
                                return keywords.map((keyword: string, index: number) => (
                                  <div key={index} className="flex items-center gap-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2.5 py-1 rounded-full text-xs font-medium">
                                    <span>{keyword}</span>
                                    <button onClick={() => {
                                      const newKeywords = keywords.filter((_: string, i: number) => i !== index);
                                      handleUpdateGroupJourney(selectedGroupJourney.id, { triggerKeywords: JSON.stringify(newKeywords) });
                                    }} className="hover:bg-red-500/20 rounded-full p-0.5"><X className="w-3 h-3" /></button>
                                  </div>
                                ));
                              })()}
                            </div>
                            <Input
                              type="text"
                              placeholder="Type keyword and press Enter..."
                              className="bg-white/60 dark:bg-gray-800/30 text-sm"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                  const newKeyword = e.currentTarget.value.trim();
                                  let keywords: string[] = [];
                                  try { keywords = selectedGroupJourney.triggerKeywords ? JSON.parse(selectedGroupJourney.triggerKeywords) : []; } catch {}
                                  if (!keywords.includes(newKeyword)) {
                                    handleUpdateGroupJourney(selectedGroupJourney.id, { triggerKeywords: JSON.stringify([...keywords, newKeyword]) });
                                    e.currentTarget.value = '';
                                  }
                                }
                              }}
                            />
                          </div>
                        )}
                      </CardHeader>

                      <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-semibold">Steps</h3>
                          <Button onClick={() => { setEditingJourneyStep(null); resetJourneyStepForm(); setJourneyStepDialogOpen(true); }} className="gap-2" size="sm">
                            <Plus className="w-4 h-4" />
                            Add Step
                          </Button>
                        </div>

                        {!selectedGroupJourney.steps || selectedGroupJourney.steps.length === 0 ? (
                          <div className="text-center py-12 border-2 border-dashed rounded-xl">
                            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p className="text-sm font-medium text-muted-foreground">No steps yet</p>
                            <p className="text-xs text-muted-foreground">Add questions to guide the conversation</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {[...(selectedGroupJourney.steps || [])].sort((a: any, b: any) => a.stepOrder - b.stepOrder).map((step: any, index: number) => (
                              <div
                                key={step.id}
                                draggable
                                onDragStart={() => handleJourneyDragStart(step.id)}
                                onDragOver={(e) => handleJourneyDragOver(e, step.id)}
                                onDragEnd={handleJourneyDragEnd}
                                className="group flex items-start gap-3 p-4 rounded-xl bg-white dark:bg-gray-800/50 hover:shadow-md transition-all cursor-move shadow-sm border"
                              >
                                <GripVertical className="w-4 h-4 text-gray-400 mt-1 flex-shrink-0 group-hover:text-purple-500" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-semibold text-purple-600 bg-purple-100 dark:bg-purple-900/40 px-2 py-0.5 rounded-full">Step {index + 1}</span>
                                    {step.isRequired === 'true' && (
                                      <span className="text-xs font-semibold text-red-600 bg-red-100 dark:bg-red-900/40 px-2 py-0.5 rounded-full">Required</span>
                                    )}
                                    {step.toolTrigger && step.toolTrigger !== 'none' && (
                                      <span className="text-xs font-semibold text-blue-600 bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded-full">{step.toolTrigger}</span>
                                    )}
                                  </div>
                                  <p className="text-sm font-medium">{step.questionText}</p>
                                  <p className="text-xs text-muted-foreground mt-1">Type: {step.questionType}</p>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button size="sm" variant="ghost" onClick={() => handleEditJourneyStep(step)} className="h-8 w-8 p-0"><Edit2 className="w-3.5 h-3.5" /></Button>
                                  <Button size="sm" variant="ghost" onClick={() => handleDeleteJourneyStep(step.id)} className="h-8 w-8 p-0 hover:bg-red-100"><Trash2 className="w-3.5 h-3.5 text-red-500" /></Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="border-red-200 dark:border-red-800/50 bg-red-50/30 dark:bg-red-950/10 shadow-sm">
                      <CardContent className="pt-6">
                        <Button variant="destructive" onClick={() => { setJourneyToDeleteId(selectedGroupJourney.id); setDeleteGroupJourneyOpen(true); }} className="gap-2">
                          <Trash2 className="w-4 h-4" />
                          Delete Journey
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <Card className="shadow-sm">
                    <CardContent className="flex flex-col items-center justify-center py-24">
                      <Route className="w-16 h-16 text-purple-300 mb-4" />
                      <h3 className="text-lg font-semibold text-gray-600 mb-2">No Journey Selected</h3>
                      <p className="text-sm text-muted-foreground text-center mb-4">Select a journey or create a new one</p>
                      <Button onClick={() => setShowJourneyTemplates(true)} className="gap-2">
                        <Plus className="w-4 h-4" />
                        Create Journey
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="menu-builder" className="space-y-6">
            {/* Menu Mode Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Menu className="w-5 h-5 text-purple-600" />
                      Menu Mode
                    </CardTitle>
                    <CardDescription>
                      Enable menu-based navigation instead of direct chat
                    </CardDescription>
                  </div>
                  <Switch
                    checked={menuEnabled}
                    onCheckedChange={(checked) => {
                      setMenuEnabled(checked);
                      setHasChanges(true);
                    }}
                  />
                </div>
              </CardHeader>
            </Card>

            {menuEnabled && (<>
            {/* Welcome Message Card */}
            <Card>
              <CardHeader>
                <CardTitle>Welcome Message</CardTitle>
                <CardDescription>
                  The greeting shown at the top of the menu
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Message</Label>
                  <Textarea
                    value={menuWelcomeMessage}
                    onChange={(e) => {
                      setMenuWelcomeMessage(e.target.value);
                      setHasChanges(true);
                    }}
                    placeholder="Hi! How can I help you today?"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Persistent CTA Card */}
            <Card>
              <CardHeader>
                <CardTitle>Persistent CTA</CardTitle>
                <CardDescription>
                  A button that stays visible at the bottom of the menu
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Enable Persistent CTA</Label>
                  <Switch
                    checked={menuPersistentCtaEnabled}
                    onCheckedChange={(checked) => {
                      setMenuPersistentCtaEnabled(checked);
                      setHasChanges(true);
                    }}
                  />
                </div>
                {menuPersistentCtaEnabled && (
                  <>
                    <div className="space-y-2">
                      <Label>Button Label</Label>
                      <Input
                        value={menuPersistentCtaLabel}
                        onChange={(e) => {
                          setMenuPersistentCtaLabel(e.target.value);
                          setHasChanges(true);
                        }}
                        placeholder="Talk to Counsellor"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Action Type</Label>
                      <Select
                        value={menuPersistentCtaAction}
                        onValueChange={(value: "chat" | "url" | "phone" | "lead_form") => {
                          setMenuPersistentCtaAction(value);
                          setHasChanges(true);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="chat">Open Chat</SelectItem>
                          <SelectItem value="url">Open URL</SelectItem>
                          <SelectItem value="phone">Call Phone</SelectItem>
                          <SelectItem value="lead_form">Open Lead Form</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {menuPersistentCtaAction === "phone" && (
                      <div className="space-y-2">
                        <Label>Phone Number</Label>
                        <Input
                          value={menuPersistentCtaValue}
                          onChange={(e) => {
                            setMenuPersistentCtaValue(e.target.value);
                            setHasChanges(true);
                          }}
                          placeholder="+1234567890"
                        />
                      </div>
                    )}
                    {menuPersistentCtaAction === "url" && (
                      <div className="space-y-2">
                        <Label>URL</Label>
                        <Input
                          value={menuPersistentCtaValue}
                          onChange={(e) => {
                            setMenuPersistentCtaValue(e.target.value);
                            setHasChanges(true);
                          }}
                          placeholder="https://example.com"
                        />
                      </div>
                    )}
                    {menuPersistentCtaAction === "lead_form" && (
                      <div className="space-y-3">
                        <Label>Fields to Capture</Label>
                        <div className="space-y-3">
                          {[
                            { key: "name", label: "Name" },
                            { key: "phone", label: "Mobile Number" },
                            { key: "email", label: "Email" },
                          ].map((field) => {
                            const fieldKey = field.key as keyof LeadFormFieldsConfig;
                            const fieldConfig = menuLeadFormFields[fieldKey];
                            const isVisible = fieldConfig?.visible ?? false;
                            const isRequired = fieldConfig?.required ?? false;
                            
                            return (
                              <div key={field.key} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                                <div className="flex items-center gap-3">
                                  <input
                                    type="checkbox"
                                    id={`menu-lead-field-${field.key}`}
                                    checked={isVisible}
                                    onChange={(e) => {
                                      const newConfig = { ...menuLeadFormFields };
                                      if (e.target.checked) {
                                        newConfig[fieldKey] = { visible: true, required: false };
                                      } else {
                                        delete newConfig[fieldKey];
                                      }
                                      if (Object.keys(newConfig).length === 0) {
                                        newConfig.name = { visible: true, required: true };
                                      }
                                      setMenuLeadFormFields(newConfig);
                                      setHasChanges(true);
                                    }}
                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                  />
                                  <label htmlFor={`menu-lead-field-${field.key}`} className="text-sm text-gray-700">
                                    {field.label}
                                  </label>
                                </div>
                                {isVisible && (
                                  <div className="flex items-center gap-2">
                                    <label htmlFor={`menu-lead-field-required-${field.key}`} className="text-xs text-gray-500">
                                      Required
                                    </label>
                                    <Switch
                                      id={`menu-lead-field-required-${field.key}`}
                                      checked={isRequired}
                                      onCheckedChange={(checked) => {
                                        const newConfig = { ...menuLeadFormFields };
                                        newConfig[fieldKey] = { visible: true, required: checked };
                                        setMenuLeadFormFields(newConfig);
                                        setHasChanges(true);
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Select which fields to show and mark them as required or optional
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Footer Card */}
            <Card>
              <CardHeader>
                <CardTitle>Footer</CardTitle>
                <CardDescription>
                  Optional footer text with a link
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Footer Text</Label>
                  <Input
                    value={menuFooterText}
                    onChange={(e) => {
                      setMenuFooterText(e.target.value);
                      setHasChanges(true);
                    }}
                    placeholder="Are you an existing customer?"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Link Text</Label>
                    <Input
                      value={menuFooterLinkText}
                      onChange={(e) => {
                        setMenuFooterLinkText(e.target.value);
                        setHasChanges(true);
                      }}
                      placeholder="Login to your account"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Link URL</Label>
                    <Input
                      value={menuFooterLinkUrl}
                      onChange={(e) => {
                        setMenuFooterLinkUrl(e.target.value);
                        setHasChanges(true);
                      }}
                      placeholder="https://example.com/login"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Menu Items Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Menu Items</CardTitle>
                    <CardDescription>
                      Create and organize your menu structure
                    </CardDescription>
                  </div>
                  <Button onClick={() => {
                    setSelectedMenuParentId(null);
                    setIsAddMenuItemDialogOpen(true);
                  }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Item
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {menuItems.filter(item => !item.parentId).length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Folder className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No menu items yet</p>
                    <p className="text-sm">Click "Add Item" to create your first menu item</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {menuItems
                      .filter(item => !item.parentId)
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((item) => (
                        <div key={item.id}>
                          <div className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50">
                            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                            <div
                              className="w-10 h-10 rounded-lg flex items-center justify-center"
                              style={{ backgroundColor: item.iconBgColor }}
                            >
                              <Folder className="w-5 h-5" style={{ color: item.iconColor }} />
                            </div>
                            <div className="flex-1">
                              <div className="font-medium">{item.title}</div>
                              {item.subtitle && (
                                <div className="text-sm text-muted-foreground">
                                  {item.subtitle}
                                </div>
                              )}
                            </div>
                            <span className="text-xs bg-muted px-2 py-1 rounded">
                              {itemTypeOptions.find((o) => o.value === item.itemType)?.label}
                            </span>
                            {item.itemType === "navigate" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedMenuParentId(item.id);
                                  setIsAddMenuItemDialogOpen(true);
                                }}
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingMenuItem(item)}
                            >
                              <Pencil className="w-4 h-4 text-muted-foreground" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setMenuItems(menuItems.filter(i => i.id !== item.id && i.parentId !== item.id));
                                setHasChanges(true);
                              }}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                          {item.itemType === "navigate" && menuItems.filter(i => i.parentId === item.id).length > 0 && (
                            <div className="ml-8 mt-2 space-y-2">
                              {menuItems
                                .filter(i => i.parentId === item.id)
                                .sort((a, b) => a.sortOrder - b.sortOrder)
                                .map((child) => (
                                  <div
                                    key={child.id}
                                    className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50"
                                  >
                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                    <div
                                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                                      style={{ backgroundColor: child.iconBgColor }}
                                    >
                                      <Folder
                                        className="w-4 h-4"
                                        style={{ color: child.iconColor }}
                                      />
                                    </div>
                                    <div className="flex-1">
                                      <div className="font-medium text-sm">{child.title}</div>
                                      {child.subtitle && (
                                        <div className="text-xs text-muted-foreground">
                                          {child.subtitle}
                                        </div>
                                      )}
                                    </div>
                                    <span className="text-xs bg-muted px-2 py-1 rounded">
                                      {itemTypeOptions.find((o) => o.value === child.itemType)?.label}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setEditingMenuItem(child)}
                                    >
                                      <Pencil className="w-4 h-4 text-muted-foreground" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        setMenuItems(menuItems.filter(i => i.id !== child.id));
                                        setHasChanges(true);
                                      }}
                                    >
                                      <Trash2 className="w-4 h-4 text-destructive" />
                                    </Button>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Add Menu Item Dialog */}
            <Dialog open={isAddMenuItemDialogOpen} onOpenChange={setIsAddMenuItemDialogOpen}>
              <DialogContent className={newMenuItem.itemType === "detail" ? "max-w-2xl max-h-[90vh] overflow-y-auto" : ""}>
                <DialogHeader>
                  <DialogTitle>Add Menu Item</DialogTitle>
                  <DialogDescription>
                    Create a new menu item for your chat widget
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input
                      value={newMenuItem.title}
                      onChange={(e) =>
                        setNewMenuItem({ ...newMenuItem, title: e.target.value })
                      }
                      placeholder="Browse Courses"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Subtitle</Label>
                    <Input
                      value={newMenuItem.subtitle}
                      onChange={(e) =>
                        setNewMenuItem({ ...newMenuItem, subtitle: e.target.value })
                      }
                      placeholder="Explore our course catalog"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Icon</Label>
                    <Select
                      value={newMenuItem.icon}
                      onValueChange={(value) =>
                        setNewMenuItem({ ...newMenuItem, icon: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {iconOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Icon Background</Label>
                      <Input
                        type="color"
                        value={newMenuItem.iconBgColor}
                        onChange={(e) =>
                          setNewMenuItem({ ...newMenuItem, iconBgColor: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Icon Color</Label>
                      <Input
                        type="color"
                        value={newMenuItem.iconColor}
                        onChange={(e) =>
                          setNewMenuItem({ ...newMenuItem, iconColor: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Action Type</Label>
                    <Select
                      value={newMenuItem.itemType}
                      onValueChange={(value) =>
                        setNewMenuItem({ ...newMenuItem, itemType: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {itemTypeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {newMenuItem.itemType !== "navigate" && newMenuItem.itemType !== "chat" && newMenuItem.itemType !== "detail" && newMenuItem.itemType !== "form" && newMenuItem.itemType !== "lead_form" && (
                    <div className="space-y-2">
                      <Label>Action Value</Label>
                      <Input
                        value={newMenuItem.actionValue}
                        onChange={(e) =>
                          setNewMenuItem({ ...newMenuItem, actionValue: e.target.value })
                        }
                        placeholder={
                          newMenuItem.itemType === "url"
                            ? "https://example.com"
                            : newMenuItem.itemType === "phone"
                            ? "+1234567890"
                            : ""
                        }
                      />
                    </div>
                  )}
                  {newMenuItem.itemType === "form" && (
                    <div className="space-y-2">
                      <Label>Journey / Form</Label>
                      <Select
                        value={newMenuItem.actionValue || ""}
                        onValueChange={(value) =>
                          setNewMenuItem({ ...newMenuItem, actionValue: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a journey..." />
                        </SelectTrigger>
                        <SelectContent>
                          {groupJourneys && groupJourneys.some(a => a.journeys.length > 0) ? (
                            groupJourneys.map((account) =>
                              account.journeys.length > 0 ? (
                                <SelectGroup key={account.accountId}>
                                  <SelectLabel>{account.accountName}</SelectLabel>
                                  {account.journeys.map((journey) => (
                                    <SelectItem key={journey.id} value={journey.id}>
                                      {journey.name} ({journey.journeyType})
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              ) : null
                            )
                          ) : (
                            <div className="px-2 py-4 text-sm text-muted-foreground text-center">No active journeys found</div>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {newMenuItem.itemType === "detail" && (
                    <DetailsBuilder
                      value={parseDetailsConfig(newMenuItem.actionValue)}
                      onChange={(config) =>
                        setNewMenuItem({ ...newMenuItem, actionValue: stringifyDetailsConfig(config) })
                      }
                    />
                  )}
                  {selectedMenuParentId && (
                    <div className="p-3 bg-muted rounded-lg text-sm">
                      Adding as child of:{" "}
                      <strong>
                        {menuItems.find((i) => i.id === selectedMenuParentId)?.title}
                      </strong>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddMenuItemDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => {
                      const newItem: MenuItem = {
                        id: Date.now().toString(),
                        parentId: selectedMenuParentId,
                        title: newMenuItem.title,
                        subtitle: newMenuItem.subtitle || null,
                        icon: newMenuItem.icon,
                        iconBgColor: newMenuItem.iconBgColor,
                        iconColor: newMenuItem.iconColor,
                        sortOrder: menuItems.filter(i => i.parentId === selectedMenuParentId).length,
                        itemType: newMenuItem.itemType,
                        actionValue: newMenuItem.actionValue || null,
                        isActive: "true",
                      };
                      setMenuItems([...menuItems, newItem]);
                      setNewMenuItem({
                        title: "",
                        subtitle: "",
                        icon: "folder",
                        iconBgColor: "#E0E7FF",
                        iconColor: "#4F46E5",
                        itemType: "navigate",
                        actionValue: "",
                      });
                      setIsAddMenuItemDialogOpen(false);
                      setHasChanges(true);
                    }} 
                    disabled={!newMenuItem.title}
                  >
                    Add Item
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Edit Menu Item Dialog */}
            <Dialog open={!!editingMenuItem} onOpenChange={(open) => { if (!open) { setEditingMenuItem(null); setShowItemAddCustomField(false); setNewItemCustomField({ label: '', fieldType: 'text', options: '', required: false }); } }}>
              <DialogContent className={editingMenuItem?.itemType === "detail" || editingMenuItem?.itemType === "lead_form" ? "max-w-2xl max-h-[90vh] overflow-y-auto" : ""}>
                <DialogHeader>
                  <DialogTitle>Edit Menu Item</DialogTitle>
                  <DialogDescription>
                    Update the menu item details
                  </DialogDescription>
                </DialogHeader>
                {editingMenuItem && (
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Title</Label>
                      <Input
                        value={editingMenuItem.title}
                        onChange={(e) =>
                          setEditingMenuItem({ ...editingMenuItem, title: e.target.value })
                        }
                        placeholder="Browse Courses"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Subtitle</Label>
                      <Input
                        value={editingMenuItem.subtitle || ""}
                        onChange={(e) =>
                          setEditingMenuItem({ ...editingMenuItem, subtitle: e.target.value })
                        }
                        placeholder="Explore our course catalog"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Icon</Label>
                      <Select
                        value={editingMenuItem.icon}
                        onValueChange={(value) =>
                          setEditingMenuItem({ ...editingMenuItem, icon: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {iconOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Icon Background</Label>
                        <Input
                          type="color"
                          value={editingMenuItem.iconBgColor}
                          onChange={(e) =>
                            setEditingMenuItem({ ...editingMenuItem, iconBgColor: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Icon Color</Label>
                        <Input
                          type="color"
                          value={editingMenuItem.iconColor}
                          onChange={(e) =>
                            setEditingMenuItem({ ...editingMenuItem, iconColor: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Action Type</Label>
                      <Select
                        value={editingMenuItem.itemType}
                        onValueChange={(value) =>
                          setEditingMenuItem({ ...editingMenuItem, itemType: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {itemTypeOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {editingMenuItem.itemType !== "navigate" && editingMenuItem.itemType !== "chat" && editingMenuItem.itemType !== "detail" && editingMenuItem.itemType !== "form" && editingMenuItem.itemType !== "lead_form" && (
                      <div className="space-y-2">
                        <Label>Action Value</Label>
                        <Input
                          value={editingMenuItem.actionValue || ""}
                          onChange={(e) =>
                            setEditingMenuItem({ ...editingMenuItem, actionValue: e.target.value })
                          }
                          placeholder={
                            editingMenuItem.itemType === "url"
                              ? "https://example.com"
                              : editingMenuItem.itemType === "phone"
                              ? "+1234567890"
                              : ""
                          }
                        />
                      </div>
                    )}
                    {editingMenuItem.itemType === "form" && (
                      <div className="space-y-2">
                        <Label>Journey / Form</Label>
                        <Select
                          value={editingMenuItem.actionValue || ""}
                          onValueChange={(value) =>
                            setEditingMenuItem({ ...editingMenuItem, actionValue: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a journey..." />
                          </SelectTrigger>
                          <SelectContent>
                            {groupJourneys && groupJourneys.some(a => a.journeys.length > 0) ? (
                              groupJourneys.map((account) =>
                                account.journeys.length > 0 ? (
                                  <SelectGroup key={account.accountId}>
                                    <SelectLabel>{account.accountName}</SelectLabel>
                                    {account.journeys.map((journey) => (
                                      <SelectItem key={journey.id} value={journey.id}>
                                        {journey.name} ({journey.journeyType})
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                ) : null
                              )
                            ) : (
                              <div className="px-2 py-4 text-sm text-muted-foreground text-center">No active journeys found</div>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {editingMenuItem.itemType === "detail" && (
                      <DetailsBuilder
                        value={parseDetailsConfig(editingMenuItem.actionValue)}
                        onChange={(config) =>
                          setEditingMenuItem({ ...editingMenuItem, actionValue: stringifyDetailsConfig(config) })
                        }
                      />
                    )}
                    {editingMenuItem.itemType === "lead_form" && (
                      <div className="space-y-3">
                        <Label>Fields to Capture</Label>
                        <div className="space-y-3">
                          {[
                            { key: "name", label: "Name" },
                            { key: "phone", label: "Mobile Number" },
                            { key: "email", label: "Email" },
                          ].map((field) => {
                            const fieldKey = field.key as keyof Omit<LeadFormFieldsConfig, 'custom'>;
                            const fieldsConfig = parseLeadFormFields(editingMenuItem.leadFormFields || undefined);
                            const fieldConfig = fieldsConfig[fieldKey] as LeadFormFieldConfig | undefined;
                            const isVisible = fieldConfig?.visible ?? false;
                            const isRequired = fieldConfig?.required ?? false;
                            
                            return (
                              <div key={field.key} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                                <div className="flex items-center gap-3">
                                  <input
                                    type="checkbox"
                                    id={`group-item-lead-field-${field.key}`}
                                    checked={isVisible}
                                    onChange={(e) => {
                                      const newConfig = { ...fieldsConfig };
                                      if (e.target.checked) {
                                        newConfig[fieldKey] = { visible: true, required: false };
                                      } else {
                                        delete newConfig[fieldKey];
                                      }
                                      const standardKeys = Object.keys(newConfig).filter(k => k !== 'custom');
                                      if (standardKeys.length === 0 && (newConfig.custom || []).length === 0) {
                                        newConfig.name = { visible: true, required: true };
                                      }
                                      setEditingMenuItem({ ...editingMenuItem, leadFormFields: stringifyLeadFormFields(newConfig) });
                                    }}
                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                  />
                                  <label htmlFor={`group-item-lead-field-${field.key}`} className="text-sm text-gray-700">
                                    {field.label}
                                  </label>
                                </div>
                                {isVisible && (
                                  <div className="flex items-center gap-2">
                                    <label htmlFor={`group-item-lead-field-required-${field.key}`} className="text-xs text-gray-500">
                                      Required
                                    </label>
                                    <Switch
                                      id={`group-item-lead-field-required-${field.key}`}
                                      checked={isRequired}
                                      onCheckedChange={(checked) => {
                                        const newConfig = { ...fieldsConfig };
                                        newConfig[fieldKey] = { visible: true, required: checked };
                                        setEditingMenuItem({ ...editingMenuItem, leadFormFields: stringifyLeadFormFields(newConfig) });
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-4 space-y-2">
                          <p className="text-sm font-medium text-gray-700">Custom Fields</p>
                          {(parseLeadFormFields(editingMenuItem.leadFormFields || undefined).custom || []).map((field) => (
                            <div key={field.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg border border-gray-200">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm text-gray-800 truncate">{field.label}</span>
                                <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded capitalize shrink-0">{field.fieldType}</span>
                                {field.required && <span className="text-xs text-red-500 shrink-0">Required</span>}
                              </div>
                              <div className="flex items-center gap-2 ml-2 shrink-0">
                                <Switch
                                  checked={field.required}
                                  onCheckedChange={(checked) => {
                                    const fieldsConfig = parseLeadFormFields(editingMenuItem.leadFormFields || undefined);
                                    const newCustom = (fieldsConfig.custom || []).map(f =>
                                      f.id === field.id ? { ...f, required: checked } : f
                                    );
                                    setEditingMenuItem({ ...editingMenuItem, leadFormFields: stringifyLeadFormFields({ ...fieldsConfig, custom: newCustom }) });
                                  }}
                                />
                                <label className="text-xs text-gray-500">Req.</label>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const fieldsConfig = parseLeadFormFields(editingMenuItem.leadFormFields || undefined);
                                    const newCustom = (fieldsConfig.custom || []).filter(f => f.id !== field.id);
                                    setEditingMenuItem({ ...editingMenuItem, leadFormFields: stringifyLeadFormFields({ ...fieldsConfig, custom: newCustom }) });
                                  }}
                                  className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </div>
                            </div>
                          ))}

                          {showItemAddCustomField ? (
                            <div className="mt-2 p-3 border border-purple-200 rounded-lg bg-purple-50 space-y-3">
                              <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Field Label</label>
                                <Input
                                  value={newItemCustomField.label}
                                  onChange={(e) => setNewItemCustomField(prev => ({ ...prev, label: e.target.value }))}
                                  placeholder="e.g. Course you are looking for"
                                  className="text-sm"
                                />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Field Type</label>
                                <Select
                                  value={newItemCustomField.fieldType}
                                  onValueChange={(v) => setNewItemCustomField(prev => ({ ...prev, fieldType: v as 'text' | 'dropdown' | 'textarea' }))}
                                >
                                  <SelectTrigger className="text-sm">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="text">Text</SelectItem>
                                    <SelectItem value="dropdown">Dropdown</SelectItem>
                                    <SelectItem value="textarea">Textarea</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              {newItemCustomField.fieldType === 'dropdown' && (
                                <div>
                                  <label className="text-xs font-medium text-gray-700 block mb-1">Options (one per line)</label>
                                  <Textarea
                                    value={newItemCustomField.options}
                                    onChange={(e) => setNewItemCustomField(prev => ({ ...prev, options: e.target.value }))}
                                    placeholder={"MBA\nBCA\nMCA\nBBA"}
                                    rows={4}
                                    className="text-sm"
                                  />
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={newItemCustomField.required}
                                  onCheckedChange={(checked) => setNewItemCustomField(prev => ({ ...prev, required: checked }))}
                                />
                                <label className="text-xs text-gray-600">Required</label>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    if (!newItemCustomField.label.trim()) return;
                                    const fieldsConfig = parseLeadFormFields(editingMenuItem.leadFormFields || undefined);
                                    const options = newItemCustomField.fieldType === 'dropdown'
                                      ? newItemCustomField.options.split('\n').map(o => o.trim()).filter(Boolean)
                                      : [];
                                    const newField: CustomLeadField = {
                                      id: crypto.randomUUID(),
                                      label: newItemCustomField.label.trim(),
                                      fieldType: newItemCustomField.fieldType,
                                      options,
                                      required: newItemCustomField.required,
                                    };
                                    const newCustom = [...(fieldsConfig.custom || []), newField];
                                    setEditingMenuItem({ ...editingMenuItem, leadFormFields: stringifyLeadFormFields({ ...fieldsConfig, custom: newCustom }) });
                                    setShowItemAddCustomField(false);
                                    setNewItemCustomField({ label: '', fieldType: 'text', options: '', required: false });
                                  }}
                                  className="text-xs"
                                >
                                  Save Field
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setShowItemAddCustomField(false);
                                    setNewItemCustomField({ label: '', fieldType: 'text', options: '', required: false });
                                  }}
                                  className="text-xs"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setShowItemAddCustomField(true)}
                              className="flex items-center gap-1.5 text-sm text-purple-600 hover:text-purple-800 font-medium mt-1"
                            >
                              <Plus className="w-4 h-4" />
                              Add Custom Field
                            </button>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground mt-2">
                          Configure which fields this lead form captures. Custom fields are saved as Topics of Interest.
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditingMenuItem(null)}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={() => {
                      if (editingMenuItem) {
                        setMenuItems(menuItems.map(item => 
                          item.id === editingMenuItem.id 
                            ? {
                                ...item,
                                title: editingMenuItem.title,
                                subtitle: editingMenuItem.subtitle,
                                icon: editingMenuItem.icon,
                                iconBgColor: editingMenuItem.iconBgColor,
                                iconColor: editingMenuItem.iconColor,
                                itemType: editingMenuItem.itemType,
                                actionValue: editingMenuItem.actionValue,
                                leadFormFields: editingMenuItem.itemType === 'lead_form' ? editingMenuItem.leadFormFields : null,
                              }
                            : item
                        ));
                        setEditingMenuItem(null);
                        setHasChanges(true);
                      }
                    }} 
                    disabled={!editingMenuItem?.title}
                  >
                    Save Changes
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <div className="flex justify-end pt-4">
              <Button
                onClick={() => setPublishDialogOpen('menuBuilder')}
                disabled={publishMutation.isPending}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Publish Menu Builder to All Accounts
              </Button>
            </div>
            </>)}
          </TabsContent>

          <TabsContent value="extra" className="space-y-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Settings className="w-5 h-5 text-purple-600" />
                  Extra Settings
                </h2>
                <p className="text-sm text-gray-500 mt-1">Configure response length, chat behavior, and inactivity nudge for all group members</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveExtraSettings} disabled={savingExtra} variant="outline">
                  {savingExtra ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save
                </Button>
                <Button onClick={handlePublishExtraSettings} disabled={publishingExtra} className="bg-purple-600 hover:bg-purple-700 text-white">
                  {publishingExtra ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  Publish to All Accounts
                </Button>
              </div>
            </div>

            {/* Response Length */}
            <Card className="shadow-sm">
              <CardContent className="pt-6">
                <h3 className="text-lg font-semibold mb-1">Response Length</h3>
                <p className="text-sm text-gray-500 mb-4">Control how detailed AI responses are</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { value: "concise", label: "Concise", icon: <Zap className="w-5 h-5" />, desc: "Short, to-the-point answers (2-3 lines)" },
                    { value: "balanced", label: "Balanced", icon: <span className="text-lg">⚖️</span>, desc: "Moderate detail with key points" },
                    { value: "detailed", label: "Detailed", icon: <FileText className="w-5 h-5" />, desc: "Comprehensive answers with full explanations" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setExtraResponseLength(opt.value)}
                      className={`p-4 rounded-lg border-2 text-left transition-all ${
                        extraResponseLength === opt.value
                          ? "border-purple-600 bg-purple-50 dark:bg-purple-950/30"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <input
                          type="radio"
                          checked={extraResponseLength === opt.value}
                          onChange={() => setExtraResponseLength(opt.value)}
                          className="accent-purple-600"
                        />
                        {opt.icon}
                        <span className="font-semibold">{opt.label}</span>
                      </div>
                      <p className="text-sm text-gray-500 ml-6">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Chat Behavior */}
            <Card className="shadow-sm">
              <CardContent className="pt-6">
                <h3 className="text-lg font-semibold mb-1">Chat Behavior</h3>
                <p className="text-sm text-gray-500 mb-4">Control how the chat widget appears</p>
                
                <div className="space-y-6">
                  {/* Auto-Open Chat */}
                  <div>
                    <h4 className="font-semibold mb-1">Auto-Open Chat</h4>
                    <p className="text-sm text-gray-500 mb-3">Automatically open the chat window when the page loads</p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: "false", label: "Off" },
                        { value: "desktop", label: "Desktop Only" },
                        { value: "mobile", label: "Mobile Only" },
                        { value: "both", label: "Both" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setExtraAutoOpenChat(opt.value)}
                          className={`px-4 py-2 rounded-lg border-2 font-medium transition-all ${
                            extraAutoOpenChat === opt.value
                              ? "border-purple-600 bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400"
                              : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* AI Activation Sound */}
                  <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                      <Volume2 className="w-5 h-5 text-purple-600" />
                      <div>
                        <p className="font-semibold">AI Activation Sound</p>
                        <p className="text-sm text-gray-500">Play a sound when chat opens</p>
                      </div>
                    </div>
                    <Switch
                      checked={extraOpeningSoundEnabled}
                      onCheckedChange={setExtraOpeningSoundEnabled}
                    />
                  </div>

                  {/* Sound Style */}
                  {extraOpeningSoundEnabled && (
                    <div>
                      <h4 className="font-semibold mb-2">Sound Style</h4>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: "chime", label: "Chime", desc: "Rising shimmer" },
                          { value: "bell", label: "Bell", desc: "Elegant tone" },
                          { value: "pop", label: "Pop", desc: "Quick & modern" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setExtraOpeningSoundStyle(opt.value)}
                            className={`px-4 py-3 rounded-lg border-2 text-center transition-all ${
                              extraOpeningSoundStyle === opt.value
                                ? "border-purple-600 bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400"
                                : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                            }`}
                          >
                            <p className="font-semibold">{opt.label}</p>
                            <p className="text-xs text-gray-500">{opt.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Inactivity Nudge */}
            <Card className="shadow-sm">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Bell className="w-5 h-5 text-purple-600" />
                    <div>
                      <h3 className="text-lg font-semibold">Inactivity Nudge</h3>
                      <p className="text-sm text-gray-500">Re-engage visitors who stop responding</p>
                    </div>
                  </div>
                  <Switch
                    checked={extraInactivityNudgeEnabled}
                    onCheckedChange={setExtraInactivityNudgeEnabled}
                  />
                </div>
                
                {extraInactivityNudgeEnabled && (
                  <div className="space-y-5 mt-4">
                    {/* Initial Delay */}
                    <div className="flex items-center gap-4">
                      <Clock className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium w-24">Initial delay</span>
                      <input
                        type="range"
                        min="5"
                        max="120"
                        value={extraInactivityNudgeDelay}
                        onChange={(e) => setExtraInactivityNudgeDelay(e.target.value)}
                        className="flex-1 accent-purple-600"
                      />
                      <span className="text-sm font-semibold w-10 text-right">{extraInactivityNudgeDelay}s</span>
                    </div>

                    {/* Use AI */}
                    <div className={`p-4 rounded-lg border-2 transition-all ${extraSmartNudgeEnabled ? "border-purple-600 bg-purple-50 dark:bg-purple-950/30" : "border-gray-200 dark:border-gray-700"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Sparkles className="w-5 h-5 text-purple-600" />
                          <div>
                            <p className="font-semibold">Use AI</p>
                            <p className="text-sm text-gray-500">AI generates contextual follow-ups based on conversation</p>
                          </div>
                        </div>
                        <Switch
                          checked={extraSmartNudgeEnabled}
                          onCheckedChange={setExtraSmartNudgeEnabled}
                        />
                      </div>
                      {extraSmartNudgeEnabled && (
                        <div className="mt-3 p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-purple-600" />
                            <p className="text-sm font-medium text-purple-700 dark:text-purple-400">AI-Powered Nudges Active</p>
                          </div>
                          <p className="text-sm text-purple-600 dark:text-purple-400 mt-1">Chroney will analyze the conversation and generate contextual follow-up questions</p>
                        </div>
                      )}
                    </div>

                    {/* Fallback Message */}
                    <div>
                      <label className="text-sm font-medium block mb-1">Fallback message</label>
                      <Input
                        value={extraInactivityNudgeMessage}
                        onChange={(e) => setExtraInactivityNudgeMessage(e.target.value)}
                        placeholder="Still there? Let me know if you need any help!"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Bottom action buttons */}
            <div className="flex gap-3 justify-end pt-2">
              <Button onClick={handleSaveExtraSettings} disabled={savingExtra} variant="outline">
                {savingExtra ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Settings
              </Button>
              <Button onClick={handlePublishExtraSettings} disabled={publishingExtra} className="bg-purple-600 hover:bg-purple-700 text-white">
                {publishingExtra ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Publish to All Accounts
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </main>
      
      {/* LSQ Field Mapping Dialog */}
      <Dialog open={showLsqMappingDialog} onOpenChange={(open) => {
        setShowLsqMappingDialog(open);
        if (!open) {
          setEditingLsqMapping(null);
          setNewLsqMapping({ leadsquaredField: '', sourceType: 'dynamic', sourceField: '', customValue: '', displayName: '', fallbackValue: '' });
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLsqMapping ? "Edit Field Mapping" : "Add Field Mapping"}</DialogTitle>
            <DialogDescription>
              Configure how a field should be mapped to LeadSquared.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                placeholder="e.g., Lead Name, Email, Phone"
                value={newLsqMapping.displayName}
                onChange={(e) => setNewLsqMapping({ ...newLsqMapping, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>LeadSquared Field Name</Label>
              <Input
                placeholder="e.g., FirstName, EmailAddress, mx_Custom_Field"
                value={newLsqMapping.leadsquaredField}
                onChange={(e) => setNewLsqMapping({ ...newLsqMapping, leadsquaredField: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                The exact field name as it appears in LeadSquared (case-sensitive)
              </p>
            </div>
            <div className="space-y-2">
              <Label>Value Type</Label>
              <Select
                value={newLsqMapping.sourceType}
                onValueChange={(value: 'dynamic' | 'custom') => setNewLsqMapping({ ...newLsqMapping, sourceType: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dynamic">Dynamic (from lead/session data)</SelectItem>
                  <SelectItem value="custom">Static (custom value)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newLsqMapping.sourceType === 'dynamic' ? (
              <>
                <div className="space-y-2">
                  <Label>Data Source</Label>
                  <Select
                    value={newLsqMapping.sourceField}
                    onValueChange={(value) => setNewLsqMapping({ ...newLsqMapping, sourceField: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a source field" />
                    </SelectTrigger>
                    <SelectContent>
                      {LSQ_DYNAMIC_SOURCE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fallback Value</Label>
                  <Input
                    placeholder="e.g., Website"
                    value={newLsqMapping.fallbackValue}
                    onChange={(e) => setNewLsqMapping({ ...newLsqMapping, fallbackValue: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    If the dynamic value is empty, this value will be sent instead
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label>Custom Value</Label>
                <Input
                  placeholder="Enter a static value"
                  value={newLsqMapping.customValue}
                  onChange={(e) => setNewLsqMapping({ ...newLsqMapping, customValue: e.target.value })}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLsqMappingDialog(false)}>Cancel</Button>
            <Button onClick={saveLsqFieldMapping} disabled={savingLsqMapping}>
              {savingLsqMapping && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingLsqMapping ? "Update Mapping" : "Add Mapping"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* LSQ Delete Mapping Confirmation */}
      <AlertDialog open={showLsqDeleteDialog} onOpenChange={setShowLsqDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Field Mapping?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This field mapping will be permanently removed from the group configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteLsqFieldMapping} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Instruction?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This instruction will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Edit Instruction Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Instruction</DialogTitle>
            <DialogDescription>
              Modify your instruction below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex gap-1 ml-auto">
                <Button type="button" variant="ghost" size="sm" onClick={() => applyFormatting('bold', true)} className="h-7 w-7 p-0">
                  <Bold className="w-4 h-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => applyFormatting('italic', true)} className="h-7 w-7 p-0">
                  <Italic className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <Textarea
              ref={editTextareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="min-h-[150px] font-mono text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* AI Refine Dialog */}
      <Dialog open={refineDialogOpen} onOpenChange={setRefineDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-500" />
              AI-Refined Instruction
            </DialogTitle>
            <DialogDescription>
              Compare your original instruction with the AI-refined version.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label className="text-sm font-medium text-muted-foreground">Original</Label>
              <div className="p-3 mt-1 bg-muted rounded-lg text-sm">
                {originalInstruction}
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium text-purple-600">Refined</Label>
              <div className="p-3 mt-1 bg-purple-50 dark:bg-purple-950/30 rounded-lg text-sm border border-purple-200 dark:border-purple-800">
                {refinedInstruction}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefineDialogOpen(false)}>Keep Original</Button>
            <Button onClick={handleAcceptRefined} className="bg-purple-600 hover:bg-purple-700">
              <Check className="w-4 h-4 mr-2" />
              Use Refined Version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Journey Template Selection Dialog */}
      <Dialog open={showJourneyTemplates} onOpenChange={setShowJourneyTemplates}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose Journey Type</DialogTitle>
            <DialogDescription>Select the type of journey to create</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            {JOURNEY_TYPES_GROUP.map((type) => (
              <Card key={type.id} className="cursor-pointer hover:border-purple-500 transition-colors" onClick={() => handleCreateGroupJourney(type)}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {type.journeyType === 'conversational' ? <MessageSquare className="w-5 h-5 text-blue-600" /> : <FileText className="w-5 h-5 text-purple-600" />}
                    {type.name}
                  </CardTitle>
                  <CardDescription>{type.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Journey Step Edit/Create Dialog */}
      <Dialog open={journeyStepDialogOpen} onOpenChange={setJourneyStepDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle>{editingJourneyStep ? "Edit Step" : "Add Step"}</DialogTitle>
            <DialogDescription>Configure the question and response handling</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div>
              <Label>Step Type</Label>
              <Select value={journeyStepForm.toolTrigger} onValueChange={(value) => setJourneyStepForm({ ...journeyStepForm, toolTrigger: value })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TOOL_TRIGGERS_GROUP
                    .filter((trigger) => {
                      if (selectedGroupJourney?.journeyType === 'form') {
                        return ['none', 'book_appointment', 'journey_complete'].includes(trigger.value);
                      }
                      return trigger.value !== 'journey_complete';
                    })
                    .map((trigger) => (
                    <SelectItem key={trigger.value} value={trigger.value}>{trigger.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {journeyStepForm.toolTrigger === 'journey_complete' && (
              <div className="space-y-3 p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <Label className="text-sm font-semibold">Journey Complete Settings</Label>
                </div>
                <div>
                  <Label>Completion Message *</Label>
                  <Textarea value={journeyStepForm.questionText} onChange={(e) => setJourneyStepForm({ ...journeyStepForm, questionText: e.target.value })} placeholder="Thank you for completing the form!" className="mt-1" rows={3} />
                </div>
                <div>
                  <Label>Continue Button (Optional)</Label>
                  <Input value={journeyStepForm.completionButtonText} onChange={(e) => setJourneyStepForm({ ...journeyStepForm, completionButtonText: e.target.value })} placeholder="Continue Exploring" className="mt-1" />
                </div>
              </div>
            )}

            {journeyStepForm.toolTrigger === 'none' && (
              <>
                <div>
                  <Label>Question Text *</Label>
                  <Textarea value={journeyStepForm.questionText} onChange={(e) => setJourneyStepForm({ ...journeyStepForm, questionText: e.target.value })} placeholder="What would you like to ask?" className="mt-1" rows={3} />
                </div>
                <div>
                  <Label>Field Type</Label>
                  <Select value={journeyStepForm.questionType} onValueChange={(value) => setJourneyStepForm({ ...journeyStepForm, questionType: value, multipleChoiceOptions: (value !== 'dropdown' && value !== 'radio') ? [] : journeyStepForm.multipleChoiceOptions })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES_GROUP.map((type) => (
                        <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {(journeyStepForm.questionType === 'dropdown' || journeyStepForm.questionType === 'radio') && (
                  <div className="border rounded-lg p-4 bg-purple-50/50 dark:bg-purple-950/20">
                    <Label className="mb-2 block">Answer Options</Label>
                    <div className="space-y-2">
                      {journeyStepForm.multipleChoiceOptions.map((option, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Input value={option} onChange={(e) => { const newOpts = [...journeyStepForm.multipleChoiceOptions]; newOpts[index] = e.target.value; setJourneyStepForm({ ...journeyStepForm, multipleChoiceOptions: newOpts }); }} placeholder={`Option ${index + 1}`} className="flex-1" />
                          <Button type="button" variant="ghost" size="sm" onClick={() => setJourneyStepForm({ ...journeyStepForm, multipleChoiceOptions: journeyStepForm.multipleChoiceOptions.filter((_, i) => i !== index) })} className="h-9 w-9 p-0"><X className="w-4 h-4 text-red-500" /></Button>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" onClick={() => setJourneyStepForm({ ...journeyStepForm, multipleChoiceOptions: [...journeyStepForm.multipleChoiceOptions, ''] })} className="w-full mt-2"><Plus className="w-4 h-4 mr-1" />Add Option</Button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Switch checked={journeyStepForm.isRequired === 'true'} onCheckedChange={(checked) => setJourneyStepForm({ ...journeyStepForm, isRequired: checked ? 'true' : 'false' })} />
                  <Label className="cursor-pointer">This field is required</Label>
                </div>

                {selectedGroupJourney?.journeyType === 'form' && (journeyStepForm.questionType === 'dropdown' || journeyStepForm.questionType === 'radio') && journeyStepForm.multipleChoiceOptions.length > 0 && (
                  <div className="border-t pt-4 mt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <X className="w-4 h-4 text-orange-500" />
                      <Label className="text-sm font-semibold">Exit on Answer (Optional)</Label>
                    </div>
                    <Select value={journeyStepForm.exitOnValue || "none"} onValueChange={(value) => setJourneyStepForm({ ...journeyStepForm, exitOnValue: value === "none" ? "" : value })}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select an option..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No exit condition</SelectItem>
                        {journeyStepForm.multipleChoiceOptions.filter(opt => opt.trim()).map((option, index) => (
                          <SelectItem key={index} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {journeyStepForm.exitOnValue && (
                      <div className="mt-2">
                        <Label className="text-sm">Exit message</Label>
                        <Textarea value={journeyStepForm.exitMessage} onChange={(e) => setJourneyStepForm({ ...journeyStepForm, exitMessage: e.target.value })} placeholder="Thank you for your time!" className="mt-1" rows={2} />
                      </div>
                    )}
                  </div>
                )}

                <div className="border-t pt-4">
                  <div className="flex items-center space-x-2">
                    <input type="checkbox" id="isConditionalGroup" checked={journeyStepForm.isConditional} onChange={(e) => setJourneyStepForm({ ...journeyStepForm, isConditional: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
                    <Label htmlFor="isConditionalGroup" className="text-sm cursor-pointer">Conditional step (only shown when skipped to)</Label>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t">
            <Button variant="outline" onClick={() => setJourneyStepDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveJourneyStep} disabled={(journeyStepForm.toolTrigger === 'none' || journeyStepForm.toolTrigger === 'journey_complete') && !journeyStepForm.questionText}>
              <Save className="w-4 h-4 mr-2" />
              {editingJourneyStep ? "Update" : "Add"} Step
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Group Journey Dialog */}
      <AlertDialog open={deleteGroupJourneyOpen} onOpenChange={setDeleteGroupJourneyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Journey?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this journey and all its steps. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteGroupJourney} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Publish Confirmation Dialog */}
      <AlertDialog open={!!publishDialogOpen} onOpenChange={(open) => !open && setPublishDialogOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Publish {publishDialogOpen === 'instructions' ? 'Instructions' : publishDialogOpen === 'leadTraining' ? 'Lead Training' : publishDialogOpen === 'leadsquared' ? 'LeadSquared' : publishDialogOpen === 'menuBuilder' ? 'Menu Builder' : 'Training'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <span className="block">
                  This will <strong>overwrite</strong> the {publishDialogOpen === 'instructions' ? 'Instructions' : publishDialogOpen === 'leadTraining' ? 'Lead Training' : publishDialogOpen === 'leadsquared' ? 'LeadSquared' : publishDialogOpen === 'menuBuilder' ? 'Menu Builder' : 'training'} settings for all member accounts in this group.
                </span>
                <span className="block text-destructive font-medium">
                  Any custom settings on individual accounts will be replaced. This action cannot be undone.
                </span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { publishMutation.mutate(publishDialogOpen || undefined); }}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            >
              {publishMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Publish to All Accounts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
