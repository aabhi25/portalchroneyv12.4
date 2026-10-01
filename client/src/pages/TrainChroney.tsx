import { useState, useEffect, useRef, useReducer, useMemo } from "react";
import {
  createDefaultLeadTrainingConfig,
  normalizeLeadTrainingConfig,
  getLeadConfigWarnings,
  moveLeadField,
  DEFAULT_CUSTOM_ASK_AFTER,
  type LeadTrainingConfig,
  type LeadCaptureStrategy,
  type IntentIntensity,
} from "@shared/leadTrainingConfig";
import {
  autosaveReducer,
  initialAutosaveState,
  hasUnsavedChanges,
  shouldAdoptServerData,
  shouldScheduleSave,
  autosaveLabel,
} from "@/lib/leadConfigAutosave";
import { LeadTimingSettings, LeadWarningList } from "@/components/LeadTimingSettings";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { Brain, Save, Check, Plus, Trash2, Edit2, X, AlertCircle, Sparkles, Loader2, Bold, Italic, GraduationCap, Info, Route, ShieldCheck, AlertTriangle, Lightbulb, TrendingUp, UserCheck, Phone, Mail, MessageSquare, ChevronUp, ChevronDown, User, Settings2, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { SETTINGS_PATHS } from "@/pages/settings/settingsPaths";
import { Switch } from "@/components/ui/switch";
import TrainingNavTabs from "@/components/TrainingNavTabs";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

interface WidgetSettings {
  id: string;
  businessAccountId: string;
  customInstructions?: string;
  createdAt: string;
  updatedAt: string;
}

interface Instruction {
  id: string;
  text: string;
  type: 'always' | 'conditional' | 'fallback';
  keywords?: string[];
}

export default function TrainChroney() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [newInstruction, setNewInstruction] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [hasLegacyData, setHasLegacyData] = useState(false);
  const [legacyText, setLegacyText] = useState("");
  const [userHasInteracted, setUserHasInteracted] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [instructionToDelete, setInstructionToDelete] = useState<string | null>(null);
  const [refineDialogOpen, setRefineDialogOpen] = useState(false);
  const [newInstructionType, setNewInstructionType] = useState<'always' | 'conditional' | 'fallback'>('always');
  const [newKeywords, setNewKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [originalInstruction, setOriginalInstruction] = useState("");
  const [refinedInstruction, setRefinedInstruction] = useState("");
  const [refiningExistingId, setRefiningExistingId] = useState<string | null>(null);
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [selectedRefinements, setSelectedRefinements] = useState<Set<string>>(new Set());
  
  // Phone validation options type
  type PhoneValidation = 'any' | '10' | '12' | '8-12';
  
  // Smart Lead Training state. Starts from the SAME defaults the server returns
  // when nothing is saved (shared/leadTrainingConfig.ts) so the screen never
  // flashes different values before the fetch lands.
  const [leadConfig, setLeadConfig] = useState<LeadTrainingConfig>(createDefaultLeadTrainingConfig);
  // Extra info the GET returns next to the config (see /api/training/lead-config).
  const [leadConfigMeta, setLeadConfigMeta] = useState<{
    source?: 'stored' | 'default';
    notes?: string[];
    warning?: { message: string; issues: string[]; repairs: string[] };
  } | null>(null);
  // Auto-save bookkeeping (version counter) — see client/src/lib/leadConfigAutosave.ts.
  const [leadAutosave, dispatchLeadAutosave] = useReducer(autosaveReducer, initialAutosaveState);
  const markLeadConfigEdited = () => dispatchLeadAutosave({ type: 'edit' });
  // Remember "Mandatory" across a turn-off/turn-on in this session (a turned-off
  // field can't be mandatory, so the saved config can't hold it).
  const requiredBeforeDisableRef = useRef<Record<string, boolean>>({});

  // Track which fields are expanded/collapsed (independent of enabled state)
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set(['name'])); // Default: name field expanded
  
  // Handler to toggle field expansion (accordion-style: only one open at a time)
  const toggleFieldExpansion = (fieldId: string) => {
    setExpandedFields(prev => {
      // If clicking the currently expanded field, close it
      if (prev.has(fieldId)) {
        return new Set(); // Close all
      } else {
        return new Set([fieldId]); // Open only this one, close all others
      }
    });
  };
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

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

  const { data: settings, isLoading } = useQuery<WidgetSettings>({
    queryKey: ["/api/widget-settings"],
  });

  // Per-business OTP/MSG91 configuration status — drives the OTP toggle's
  // disabled state and the "Configure" deep-link. Falls back to env-level
  // MSG91 creds when no business-level row exists.
  const { data: otpSettings } = useQuery<{
    businessConfigured: boolean;
    envFallbackConfigured: boolean;
    effectivelyConfigured: boolean;
    whatsappEffectivelyConfigured?: boolean;
    availableChannels?: Array<'sms' | 'whatsapp'>;
  }>({
    queryKey: ["/api/admin/otp-settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/otp-settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch OTP settings");
      return res.json();
    },
  });
  // Task #3: "OTP is usable" is true when ANY channel is configured —
  // SMS, WhatsApp, or both. We keep msg91Configured as the legacy name to
  // minimize diff surface for the existing toggle/tooltip logic.
  const smsConfigured = !!otpSettings?.effectivelyConfigured;
  const whatsappConfigured = !!otpSettings?.whatsappEffectivelyConfigured;
  // "Can a code actually be sent?" — the runtime only uses channels that match
  // the admin's channel preference (availableChannels), so mirror that here.
  // undefined while the OTP settings are still loading (never blocks then).
  const otpChannelReady: boolean | undefined = otpSettings
    ? (Array.isArray(otpSettings.availableChannels) ? otpSettings.availableChannels.length > 0 : (smsConfigured || whatsappConfigured))
    : undefined;
  const msg91Configured = otpChannelReady ?? (smsConfigured || whatsappConfigured);

  // Per-business CAPTCHA (reCAPTCHA v2) secret-key status. The site key lives in
  // the lead config (public, safe to expose); the secret key is write-only and
  // stored AES-256-GCM encrypted, surfaced here only as a "configured" flag +
  // mask so admins can tell whether a secret is set without ever seeing it.
  const { data: captchaSettings, refetch: refetchCaptchaSettings } = useQuery<{
    provider: string;
    hasSecretKey: boolean;
    secretKeyMasked: string;
    secretConfigured: boolean;
  }>({
    queryKey: ["/api/admin/captcha-settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/captcha-settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch captcha settings");
      return res.json();
    },
  });
  const captchaSecretConfigured = !!captchaSettings?.secretConfigured;
  // Local draft for the write-only secret key input (never pre-filled with the
  // real value). Empty string => "leave existing secret unchanged" on save.
  const [captchaSecretDraft, setCaptchaSecretDraft] = useState("");
  const captchaSecretMutation = useMutation({
    mutationFn: async (secretKey: string) => {
      const res = await fetch("/api/admin/captcha-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ secretKey }),
      });
      if (!res.ok) throw new Error("Failed to save captcha secret key");
      return res.json();
    },
    onSuccess: () => {
      setCaptchaSecretDraft("");
      refetchCaptchaSettings();
      toast({ title: "CAPTCHA secret key saved" });
    },
    onError: () => {
      toast({ title: "Failed to save CAPTCHA secret key", variant: "destructive" });
    },
  });

  // Fetch lead training config (scoped to business account for multi-tenancy)
  const { data: fetchedLeadConfig } = useQuery({
    queryKey: ["lead-config", settings?.id], // Cache key includes settings.id for multi-tenancy
    queryFn: async () => {
      const res = await fetch("/api/training/lead-config", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch lead config");
      return res.json();
    },
    enabled: !!settings?.id, // Only fetch when we have business account context
  });

  // Start over when the business account changes (multi-tenancy).
  useEffect(() => {
    dispatchLeadAutosave({ type: 'reset' });
  }, [settings?.id]);

  // Adopt the server copy only when there are no local edits waiting and no
  // save in flight — so edits made while a save is running are never wiped.
  useEffect(() => {
    if (!fetchedLeadConfig || !Array.isArray((fetchedLeadConfig as any).fields)) return;
    if (!shouldAdoptServerData(leadAutosave)) return;
    const { _meta, ...rest } = fetchedLeadConfig as any;
    // Server already normalises (sorted by priority, priorities 1..4, legacy
    // timings migrated); running the same shared normaliser again is a no-op
    // safety net so the list renders in priority order on load.
    setLeadConfig(normalizeLeadTrainingConfig(rest).config);
    setLeadConfigMeta(_meta ?? null);
  }, [fetchedLeadConfig, leadAutosave.version, leadAutosave.savedVersion, leadAutosave.inFlightVersion]);

  // Save lead config mutation. `version` is the edit counter the request
  // carries, so a late success only marks THAT version as saved.
  const saveLeadConfigMutation = useMutation({
    mutationFn: async ({ config }: { config: LeadTrainingConfig; version: number }) => {
      const { _meta, ...body } = config as any;
      const response = await fetch("/api/training/lead-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // Surface the server's validation details (zod) instead of a generic error.
        let message = `Couldn't save lead settings (HTTP ${response.status}).`;
        try {
          const json = await response.json();
          const details: string[] = Array.isArray(json?.details)
            ? json.details.map((d: any) => (typeof d === 'string' ? d : d?.message)).filter(Boolean)
            : [];
          message = details.length ? details.join(' ') : (json?.error || message);
        } catch { /* non-JSON error body */ }
        throw new Error(message);
      }
      return response.json();
    },
    onMutate: ({ version }) => {
      dispatchLeadAutosave({ type: 'saveStarted', version });
    },
    onSuccess: (savedConfig, { version }) => {
      queryClient.setQueryData(["lead-config", settings?.id], savedConfig);
      dispatchLeadAutosave({ type: 'saveSucceeded', version });
    },
    onError: (error: any, { version }) => {
      dispatchLeadAutosave({ type: 'saveFailed', version, error: error?.message || 'Save failed' });
      toast({
        title: "Lead settings not saved",
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  // Warnings for odd/invalid combinations (shared with the group editor).
  const leadWarnings = useMemo(
    () => getLeadConfigWarnings(leadConfig, { otpChannelReady }),
    [leadConfig, otpChannelReady],
  );

  // True only when a non-empty URL fails the https/URL check (used to surface an
  // inline error and to block the auto-save of an invalid value).
  const conversionUrlInvalid = (() => {
    const v = (leadConfig.conversionUrl || '').trim();
    if (!v) return false;
    try {
      return new URL(v).protocol !== 'https:';
    } catch {
      return true;
    }
  })();

  // Anything that would make the server reject the config pauses auto-save
  // (the status line says why) instead of firing a request that must fail.
  const leadSaveBlockedReason: string | null = leadWarnings.some((w) => w.level === 'block')
    ? 'fix the issue highlighted below'
    : conversionUrlInvalid
      ? 'enter a valid https conversion URL'
      : null;

  // Auto-save (debounced). Re-runs when a save finishes, so edits made while it
  // was in flight are saved next.
  useEffect(() => {
    if (!shouldScheduleSave(leadAutosave, !!leadSaveBlockedReason)) return;
    const version = leadAutosave.version;
    const config = leadConfig;
    const timeoutId = setTimeout(() => {
      saveLeadConfigMutation.mutate({ config, version });
    }, 800); // 800ms debounce
    return () => clearTimeout(timeoutId);
  }, [leadConfig, leadAutosave.version, leadAutosave.inFlightVersion, leadAutosave.status, leadSaveBlockedReason]);

  const retryLeadConfigSave = () => {
    saveLeadConfigMutation.mutate({ config: leadConfig, version: leadAutosave.version });
  };

  // Warn before leaving with unsaved lead settings: browser close/reload, and
  // in-app links (best effort — clicks on same-origin <a> elements).
  const leadConfigUnsaved = hasUnsavedChanges(leadAutosave) || leadAutosave.inFlightVersion !== null;
  useEffect(() => {
    if (!leadConfigUnsaved) return;
    const message = 'Your lead training changes are not saved yet. Leave this page anyway?';
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
      return message;
    };
    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank') return;
      let url: URL;
      try { url = new URL(anchor.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [leadConfigUnsaved]);

  useEffect(() => {
    if (settings?.customInstructions) {
      try {
        const parsed = JSON.parse(settings.customInstructions);
        if (Array.isArray(parsed)) {
          // Normalize legacy instructions: add type: 'always' if missing
          const normalized = parsed.map((instr: any) => ({
            ...instr,
            type: instr.type || 'always',
            keywords: instr.keywords || undefined,
          }));
          setInstructions(normalized);
          setHasLegacyData(false);
        } else {
          setInstructions([]);
          setHasLegacyData(false);
        }
      } catch {
        const trimmed = settings.customInstructions.trim();
        if (trimmed) {
          setHasLegacyData(true);
          setLegacyText(trimmed);
        } else {
          setInstructions([]);
          setHasLegacyData(false);
        }
      }
    } else {
      setInstructions([]);
      setHasLegacyData(false);
    }
  }, [settings]);

  useEffect(() => {
    if (!settings || !userHasInteracted || hasLegacyData) return;
    
    const currentInstructionsStr = JSON.stringify(instructions);
    const savedInstructionsStr = settings.customInstructions || "[]";
    
    const hasChanges = currentInstructionsStr !== savedInstructionsStr;

    if (!hasChanges) {
      setSaveStatus("idle");
      return;
    }
    
    const timeoutId = setTimeout(() => {
      setSaveStatus("saving");
      updateMutation.mutate({ customInstructions: currentInstructionsStr });
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [instructions, settings, userHasInteracted, hasLegacyData]);

  const updateMutation = useMutation({
    mutationFn: async (data: { customInstructions: string }) => {
      const response = await fetch("/api/widget-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update custom instructions");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/widget-settings"] });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save custom instructions",
        variant: "destructive",
      });
      setSaveStatus("idle");
    },
  });

  const saveImmediately = (instructionsToSave: Instruction[]) => {
    setSaveStatus("saving");
    updateMutation.mutate({ customInstructions: JSON.stringify(instructionsToSave) });
  };

  const handleMigrateLegacy = () => {
    const lines = legacyText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    const migratedInstructions: Instruction[] = lines.map((line, index) => ({
      id: `migrated-${Date.now()}-${index}`,
      text: line.replace(/^[-*•]\s*/, ''),
      type: 'always' as const,
    }));
    
    setInstructions(migratedInstructions);
    setHasLegacyData(false);
    setUserHasInteracted(true);
    
    toast({
      title: "Migration Complete",
      description: `Converted ${migratedInstructions.length} instruction(s) to the new format.`,
    });
  };

  const handleDiscardLegacy = () => {
    setHasLegacyData(false);
    setLegacyText("");
    setInstructions([]);
    setUserHasInteracted(true);
  };

  // Check if a fallback instruction already exists
  const hasFallbackInstruction = instructions.some(instr => instr.type === 'fallback');

  const handleAddInstruction = () => {
    if (!newInstruction.trim()) return;
    
    // For conditional instructions, require at least one keyword
    if (newInstructionType === 'conditional' && newKeywords.length === 0) {
      toast({
        title: "Keywords Required",
        description: "Please add at least one trigger keyword for conditional instructions.",
        variant: "destructive",
      });
      return;
    }
    
    // Only allow one fallback instruction
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
    
    const updatedInstructions = [...instructions, newInstr];
    setInstructions(updatedInstructions);
    setNewInstruction("");
    setNewInstructionType('always');
    setNewKeywords([]);
    setKeywordInput("");
    setUserHasInteracted(true);
    
    saveImmediately(updatedInstructions);
  };

  const handleDeleteClick = (id: string) => {
    setInstructionToDelete(id);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (instructionToDelete) {
      const updatedInstructions = instructions.filter(instr => instr.id !== instructionToDelete);
      setInstructions(updatedInstructions);
      setUserHasInteracted(true);
      
      saveImmediately(updatedInstructions);
    }
    setDeleteDialogOpen(false);
    setInstructionToDelete(null);
  };

  const handleCancelDelete = () => {
    setDeleteDialogOpen(false);
    setInstructionToDelete(null);
  };

  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const handleStartEdit = (instruction: Instruction) => {
    setEditingId(instruction.id);
    setEditText(instruction.text);
    setEditDialogOpen(true);
  };

  const handleCancelEdit = () => {
    setEditDialogOpen(false);
    setEditingId(null);
    setEditText("");
  };

  const handleSaveEdit = () => {
    if (!editText.trim() || !editingId) return;
    
    const updatedInstructions = instructions.map(instr => 
      instr.id === editingId 
        ? { ...instr, text: editText.trim() }
        : instr
    );
    setInstructions(updatedInstructions);
    
    setEditDialogOpen(false);
    setEditingId(null);
    setEditText("");
    setUserHasInteracted(true);
    
    saveImmediately(updatedInstructions);
  };

  // Auto-resize edit textarea when dialog opens with content
  useEffect(() => {
    if (editDialogOpen && editTextareaRef.current) {
      const textarea = editTextareaRef.current;
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
      });
    }
  }, [editDialogOpen, editText]);

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
        title: "Error",
        description: error.message || "Failed to refine instruction with AI",
        variant: "destructive",
      });
    } finally {
      setIsRefining(false);
    }
  };

  const handleRefineExistingInstruction = async (instruction: Instruction) => {
    setIsRefining(true);
    setOriginalInstruction(instruction.text);
    setRefiningExistingId(instruction.id);

    try {
      const response = await fetch('/api/ai/refine-instruction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ instruction: instruction.text })
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
        title: "Error",
        description: error.message || "Failed to refine instruction with AI",
        variant: "destructive",
      });
    } finally {
      setIsRefining(false);
    }
  };

  const handleApplyRefinedInstruction = () => {
    let updatedInstructions: Instruction[];
    
    if (refiningExistingId) {
      // Update existing instruction
      updatedInstructions = instructions.map(instr =>
        instr.id === refiningExistingId
          ? { ...instr, text: refinedInstruction.trim() }
          : instr
      );
      toast({
        title: "Instruction Updated",
        description: "Your refined instruction has been updated successfully!",
      });
    } else {
      // Add new instruction
      const newInstr: Instruction = {
        id: Date.now().toString(),
        text: refinedInstruction.trim(),
        type: newInstructionType,
        keywords: newInstructionType === 'conditional' ? newKeywords : undefined,
      };
      updatedInstructions = [...instructions, newInstr];
      setNewInstruction("");
      setNewInstructionType('always');
      setNewKeywords([]);
      toast({
        title: "Instruction Added",
        description: "Your refined instruction has been added successfully!",
      });
    }
    
    setInstructions(updatedInstructions);
    setRefineDialogOpen(false);
    setRefiningExistingId(null);
    setUserHasInteracted(true);
    
    saveImmediately(updatedInstructions);
  };

  const handleCancelRefine = () => {
    setRefineDialogOpen(false);
    setRefinedInstruction("");
    setOriginalInstruction("");
    setRefiningExistingId(null);
  };

  const handleAnalyzeInstructions = async () => {
    if (instructions.length === 0) {
      toast({
        title: "No Instructions",
        description: "Add some instructions first to analyze them.",
        variant: "destructive",
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisDialogOpen(true);

    try {
      const response = await fetch('/api/training/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ instructions })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to analyze instructions');
      }

      const data = await response.json();
      setAnalysisResult(data);
      
      // Auto-select all refinements
      const allRefinements = new Set<string>(data.refinements.map((r: any) => r.instructionId));
      setSelectedRefinements(allRefinements);
      
    } catch (error: any) {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze instructions",
        variant: "destructive",
      });
      setAnalysisDialogOpen(false);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyAllFixes = () => {
    if (!analysisResult) return;

    let updatedInstructions = [...instructions];

    // Apply ALL refinements
    if (analysisResult.refinements && analysisResult.refinements.length > 0) {
      analysisResult.refinements.forEach((refinement: any) => {
        updatedInstructions = updatedInstructions.map(instr =>
          instr.id === refinement.instructionId
            ? { ...instr, text: refinement.refinedText }
            : instr
        );
      });
    }

    setInstructions(updatedInstructions);
    setUserHasInteracted(true);
    saveImmediately(updatedInstructions);
    setAnalysisDialogOpen(false);
    setSelectedRefinements(new Set());
    setAnalysisResult(null);
    
    toast({
      title: "All Refinements Applied",
      description: `Applied ${analysisResult.refinements?.length || 0} refinements to your instructions.`,
    });
  };

  const handleApplyAnalysis = () => {
    if (!analysisResult) return;

    let updatedInstructions = [...instructions];

    // Apply selected refinements
    selectedRefinements.forEach(instructionId => {
      const refinement = analysisResult.refinements.find((r: any) => r.instructionId === instructionId);
      if (refinement) {
        updatedInstructions = updatedInstructions.map(instr =>
          instr.id === instructionId
            ? { ...instr, text: refinement.refinedText }
            : instr
        );
      }
    });

    setInstructions(updatedInstructions);
    setUserHasInteracted(true);
    saveImmediately(updatedInstructions);
    setAnalysisDialogOpen(false);
    setAnalysisResult(null);
    setSelectedRefinements(new Set());

    toast({
      title: "Refinements Applied",
      description: `Applied ${selectedRefinements.size} selected refinements to your instructions.`,
    });
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'text-red-600 dark:text-red-400';
      case 'medium': return 'text-amber-600 dark:text-amber-400';
      case 'low': return 'text-blue-600 dark:text-blue-400';
      default: return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getSeverityBg = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/30';
      case 'medium': return 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30';
      case 'low': return 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/30';
      default: return 'bg-gray-50 dark:bg-gray-950/20 border-gray-200 dark:border-gray-900/30';
    }
  };

  // Lead Config Handlers
  const handleFieldToggle = (fieldId: string) => {
    markLeadConfigEdited();
    const current = leadConfig.fields.find(f => f.id === fieldId);
    // Turning off: remember Mandatory so turning back on restores it.
    if (current?.enabled) requiredBeforeDisableRef.current[fieldId] = !!current.required;
    const restoreRequired = !!requiredBeforeDisableRef.current[fieldId];

    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id !== fieldId) return f;
        // Only the on/off state changes. Timing and its details (ask-after,
        // sensitivity, keywords) are kept, so re-enabling a field brings back
        // exactly what it had. A turned-off field can't be mandatory.
        return f.enabled
          ? { ...f, enabled: false, required: false }
          : { ...f, enabled: true, required: restoreRequired };
      }),
    }));
  };

  const handleRequiredToggle = (fieldId: string) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id === fieldId && f.enabled) {
          return { ...f, required: !f.required };
        }
        return f;
      })
    }));
  };

  const handlePhoneValidationChange = (fieldId: string, validation: PhoneValidation) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id === fieldId) {
          return { ...f, phoneValidation: validation };
        }
        return f;
      })
    }));
  };

  const handleOtpEnabledToggle = (fieldId: string) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id === fieldId) {
          // Task #18: if OTP is turned OFF, also turn OFF the dependent
          // "only count after verify" toggle so the persisted config stays
          // internally consistent.
          const nextOtpEnabled = !f.otpEnabled;
          return {
            ...f,
            otpEnabled: nextOtpEnabled,
            otpRequiredForCounting: nextOtpEnabled ? f.otpRequiredForCounting : false,
          };
        }
        return f;
      })
    }));
  };

  // Task #18: toggle for "Only count conversation/lead after OTP verification".
  // Visible only when mobile + captureStrategy=start + otpEnabled — the admin
  // UI enforces the same gate that the server uses to set awaitingVerification.
  const handleOtpRequiredForCountingToggle = (fieldId: string) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id === fieldId) {
          return { ...f, otpRequiredForCounting: !f.otpRequiredForCounting };
        }
        return f;
      })
    }));
  };

  // Demo / Sample OTP: switch OTP ON with no SMS/WhatsApp provider configured.
  // Enabling it also selects OTP as the verification method (and clears CAPTCHA);
  // disabling it turns OTP back off unless a real provider is configured.
  const handleOtpDemoModeToggle = (fieldId: string) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id !== fieldId) return f;
        const next = !f.otpDemoMode;
        if (next) {
          return { ...f, otpDemoMode: true, otpEnabled: true, captchaEnabled: false };
        }
        return { ...f, otpDemoMode: false, otpEnabled: msg91Configured ? f.otpEnabled : false };
      }),
    }));
  };

  // Conversion tracking (Google Ads): set the https "thank-you" page URL fired in
  // the visitor's browser when a mobile number is captured. Empty = disabled.
  const handleConversionUrlChange = (value: string) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({ ...prev, conversionUrl: value }));
  };

  const handleConversionBadgeToggle = () => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({ ...prev, conversionBadgeEnabled: !prev.conversionBadgeEnabled }));
  };

  // Verification method picker (None / OTP / CAPTCHA). OTP and CAPTCHA are
  // mutually exclusive — the server enforces this too, but we keep the UI
  // internally consistent so the saved config never has both flags set.
  const handleVerificationMethodChange = (fieldId: string, method: 'none' | 'otp' | 'captcha') => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id !== fieldId) return f;
        if (method === 'otp') {
          return { ...f, otpEnabled: true, captchaEnabled: false };
        }
        if (method === 'captcha') {
          return {
            ...f,
            captchaEnabled: true,
            captchaProvider: 'recaptcha_v2',
            otpEnabled: false,
            otpRequiredForCounting: false,
            otpDemoMode: false,
          };
        }
        // none
        return { ...f, otpEnabled: false, captchaEnabled: false, otpRequiredForCounting: false, otpDemoMode: false };
      }),
    }));
  };

  const handleCaptchaSiteKeyChange = (fieldId: string, siteKey: string) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f =>
        f.id === fieldId ? { ...f, captchaSiteKey: siteKey } : f
      ),
    }));
  };

  const handleSendUnverifiedToggle = (fieldId: string) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f =>
        f.id === fieldId ? { ...f, sendUnverifiedLeadsToCrm: !f.sendUnverifiedLeadsToCrm } : f
      ),
    }));
  };

  const getPhoneValidationLabel = (validation: PhoneValidation | undefined): string => {
    switch (validation) {
      case '10': return '10 digits';
      case '12': return '12 digits';
      case '8-12': return '8-12 digits';
      case 'any': return 'Any length';
      default: return '10 digits';
    }
  };

  const handleStrategyChange = (fieldId: string, strategy: LeadCaptureStrategy) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id !== fieldId) return f;
        // Fill the chosen timing's detail if it has none yet; keep the other
        // timings' details so switching back restores them.
        return {
          ...f,
          captureStrategy: strategy,
          customAskAfter: strategy === 'custom' ? (f.customAskAfter ?? DEFAULT_CUSTOM_ASK_AFTER) : f.customAskAfter,
          intentIntensity: strategy === 'intent' ? (f.intentIntensity ?? 'medium') : f.intentIntensity,
          captureKeywords: strategy === 'keyword' ? (f.captureKeywords ?? []) : f.captureKeywords,
        };
      })
    }));
  };

  // Keywords commit on Enter, comma or leaving the box (LeadKeywordInput).
  const handleKeywordsChange = (fieldId: string, keywords: string[]) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f =>
        f.id === fieldId ? { ...f, captureKeywords: keywords } : f
      )
    }));
  };

  const handleIntentIntensityChange = (fieldId: string, intensity: IntentIntensity) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id === fieldId) {
          return { ...f, intentIntensity: intensity };
        }
        return f;
      })
    }));
  };

  const handleCustomAskAfterChange = (fieldId: string, value: number) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({
      ...prev,
      fields: prev.fields.map(f => {
        if (f.id === fieldId) {
          return { ...f, customAskAfter: Math.max(1, Math.min(20, value)) };
        }
        return f;
      })
    }));
  };

  // Reorder: swap with the neighbour and renumber priorities 1..4 (shared helper).
  const handleMoveFieldUp = (fieldId: string) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({ ...prev, fields: moveLeadField(prev.fields, fieldId, -1) }));
  };

  const handleMoveFieldDown = (fieldId: string) => {
    markLeadConfigEdited();
    setLeadConfig(prev => ({ ...prev, fields: moveLeadField(prev.fields, fieldId, 1) }));
  };

  const getFieldIcon = (fieldId: string) => {
    switch (fieldId) {
      case 'name': return <UserCheck className="w-4 h-4" />;
      case 'mobile': return <Phone className="w-4 h-4" />;
      case 'whatsapp': return <MessageSquare className="w-4 h-4" />;
      case 'email': return <Mail className="w-4 h-4" />;
      default: return null;
    }
  };

  const getFieldLabel = (fieldId: string) => {
    switch (fieldId) {
      case 'name': return 'Full Name';
      case 'mobile': return 'Mobile Number';
      case 'whatsapp': return 'WhatsApp Number';
      case 'email': return 'Email Address';
      default: return fieldId;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <TrainingNavTabs />
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">Loading training data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <TrainingNavTabs />
      <div className="p-6 md:p-8 lg:p-12 max-w-5xl mx-auto">
        {/* Header Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shadow-lg">
                <GraduationCap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">
                  Train Chroney
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Teach your AI assistant how to respond to customers
                </p>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {saveStatus !== "idle" && (
                <div className="flex items-center gap-2">
                  {saveStatus === "saving" && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-1.5 rounded-full bg-muted/50">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </div>
                  )}
                  {saveStatus === "saved" && (
                    <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 px-3 py-1.5 rounded-full bg-green-50 dark:bg-green-950/30">
                      <Check className="w-3.5 h-3.5" />
                      <span>Saved</span>
                    </div>
                  )}
                </div>
              )}
              
              {!hasLegacyData && instructions.length > 0 && (
                <Button
                  onClick={handleAnalyzeInstructions}
                  disabled={isAnalyzing}
                  className="gap-2 bg-gradient-to-r from-purple-600 via-purple-700 to-red-600 hover:from-purple-700 hover:via-purple-800 hover:to-red-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2.5 rounded-xl"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-5 h-5" />
                      Analyze Instructions
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Legacy Data Migration Banner */}
        {hasLegacyData && (
          <Card className="mb-6 border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold text-amber-900 dark:text-amber-200 mb-2">
                    Legacy Instructions Detected
                  </h3>
                  <p className="text-sm text-amber-800 dark:text-amber-300 mb-3">
                    You have existing instructions in the old format. Would you like to migrate them to the new list-based format?
                  </p>
                  <div className="p-3 bg-white dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-800 mb-3 max-h-32 overflow-y-auto">
                    <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                      {legacyText}
                    </pre>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleMigrateLegacy}
                      size="sm"
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      Migrate to New Format
                    </Button>
                    <Button
                      onClick={handleDiscardLegacy}
                      size="sm"
                      variant="outline"
                    >
                      Start Fresh
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!hasLegacyData && (
          <Tabs defaultValue="instructions" className="w-full">
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
            </TabsList>

            <TabsContent value="instructions" className="space-y-6">
              {/* Add New Instruction Card */}
              <Card className="shadow-sm">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  {/* Instruction Type Selector - Now at the top */}
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
                      <div className="text-xs text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 p-2 rounded">
                        <span className="font-medium">Example:</span> I don't have that info, but I'd love to help! {"{{if_missing_phone}}"}Could you share your number?{"{{/if_missing_phone}}"} {"{{if_has_phone}}"}Our team will call you soon!{"{{/if_has_phone}}"}
                      </div>
                      
                      {/* Quick Templates Section */}
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

                  {/* Keyword Input for Conditional Instructions - Between Type and Instruction */}
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
                            onChange={(e) => {
                              setNewInstruction(e.target.value);
                              e.target.style.height = 'auto';
                              e.target.style.height = Math.max(80, e.target.scrollHeight) + 'px';
                            }}
                            placeholder={newInstructionType === 'fallback' 
                              ? "Type the exact message customers will see when AI can't answer their question..." 
                              : "Type your instruction in plain English..."}
                            className="min-h-[80px] resize-none rounded-t-none border-t-0 text-sm"
                            rows={3}
                          />
                        </div>
                      </div>
                      
                      <div className="flex gap-2 justify-end">
                        <Button 
                          onClick={handleRefineWithAI}
                          disabled={!newInstruction.trim() || isRefining}
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                        >
                          {isRefining ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Refining...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              Refine with AI
                            </>
                          )}
                        </Button>
                        <Button 
                          onClick={handleAddInstruction}
                          disabled={!newInstruction.trim() || (newInstructionType === 'conditional' && newKeywords.length === 0)}
                          size="sm"
                          className="gap-1.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {newInstructionType === 'fallback' ? 'Add Template' : 'Add Instruction'}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Instructions List */}
            <div className="space-y-4 mb-6">
              {instructions.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-12">
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-full bg-purple-50 dark:bg-purple-950/30 flex items-center justify-center mx-auto mb-4">
                        <Brain className="w-8 h-8 text-purple-400" />
                      </div>
                      <h3 className="text-sm font-medium text-foreground mb-1">No instructions yet</h3>
                      <p className="text-sm text-muted-foreground">
                        Add your first instruction above to start training Chroney
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  <h2 className="text-sm font-medium text-muted-foreground mb-3">
                    Active Instructions ({instructions.length})
                  </h2>
                  {instructions.map((instruction, index) => (
                    <Card 
                      key={instruction.id}
                      className={`group hover:shadow-md transition-all duration-200 ${
                        instruction.type === 'conditional' 
                          ? 'border-l-4 border-l-amber-400' 
                          : instruction.type === 'fallback'
                          ? 'border-l-4 border-l-blue-400'
                          : 'border-l-4 border-l-green-400'
                      }`}
                    >
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-start gap-4">
                          <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold ${
                            instruction.type === 'conditional'
                              ? 'bg-gradient-to-br from-amber-500 to-orange-500'
                              : instruction.type === 'fallback'
                              ? 'bg-gradient-to-br from-blue-500 to-indigo-500'
                              : 'bg-gradient-to-br from-green-600 to-emerald-600'
                          }`}>
                            {index + 1}
                          </div>
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${
                                instruction.type === 'conditional'
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                  : instruction.type === 'fallback'
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                  : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                              }`}>
                                {instruction.type === 'conditional' ? (
                                  <><Route className="w-3 h-3" /> Conditional</>
                                ) : instruction.type === 'fallback' ? (
                                  <><AlertCircle className="w-3 h-3" /> Fallback</>
                                ) : (
                                  <><Check className="w-3 h-3" /> Always Active</>
                                )}
                              </span>
                            </div>
                            <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                              {renderFormattedText(instruction.text)}
                            </p>
                            {instruction.type === 'conditional' && instruction.keywords && instruction.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                <span className="text-xs text-muted-foreground">Triggers on:</span>
                                {instruction.keywords.map((keyword, kIndex) => (
                                  <span
                                    key={kIndex}
                                    className="inline-flex px-2 py-0.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs rounded-full"
                                  >
                                    {keyword}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleRefineExistingInstruction(instruction)}
                                    className="h-8 w-8 p-0 hover:bg-purple-50 dark:hover:bg-purple-950/20 hover:text-purple-600"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Refine with AI</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleStartEdit(instruction)}
                              className="h-8 w-8 p-0 hover:bg-blue-50 dark:hover:bg-blue-950/20 hover:text-blue-600"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteClick(instruction.id)}
                              className="h-8 w-8 p-0 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              </div>

              {/* Info Cards */}
              <div className="grid md:grid-cols-2 gap-4">
                <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/30">
                  <CardContent className="pt-5 pb-5">
                    <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-3 flex items-center gap-2">
                      <span className="text-lg">💡</span>
                      How it Works
                    </h3>
                    <ul className="text-xs text-blue-800 dark:text-blue-300 space-y-2">
                      <li className="flex gap-2">
                        <span className="text-blue-400">•</span>
                        <span>Add instructions in plain English - no coding needed</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-400">•</span>
                        <span>Use AI refinement to improve clarity</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-400">•</span>
                        <span>Changes save automatically and apply instantly</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-blue-400">•</span>
                        <span>Instructions are private to your business</span>
                      </li>
                    </ul>
                  </CardContent>
                </Card>

                <Card className="bg-purple-50/50 dark:bg-purple-950/20 border-purple-100 dark:border-purple-900/30">
                  <CardContent className="pt-5 pb-5">
                    <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-200 mb-3 flex items-center gap-2">
                      <span className="text-lg">✨</span>
                      Example Instructions
                    </h3>
                    <ul className="text-xs text-purple-800 dark:text-purple-300 space-y-2">
                      <li className="flex gap-2">
                        <span className="text-purple-400">→</span>
                        <span>"Mention our 30-day return policy when asked"</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-purple-400">→</span>
                        <span>"For wholesale inquiries, collect company details"</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-purple-400">→</span>
                        <span>"Always be friendly and professional"</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="text-purple-400">→</span>
                        <span>"Offer live chat support for urgent issues"</span>
                      </li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="lead-training" className="space-y-6">
              {/* Smart Lead Training Card */}
              <Card className="shadow-sm bg-gradient-to-br from-green-50/50 via-emerald-50/30 to-teal-50/50 dark:from-green-950/20 dark:via-emerald-950/10 dark:to-teal-950/20 border-green-200 dark:border-green-900/30">
              <CardHeader>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-600 flex items-center justify-center shadow-lg shrink-0">
                    <UserCheck className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-[12rem]">
                    <CardTitle className="text-xl">Smart Lead Training</CardTitle>
                    <CardDescription className="mt-1">
                      Configure which contact information Chroney should collect
                    </CardDescription>
                  </div>
                  {/* Auto-save status: Saving… / Saved / Not saved — retry */}
                  {(() => {
                    const label = autosaveLabel(leadAutosave, leadSaveBlockedReason);
                    if (!label) return null;
                    const failed = hasUnsavedChanges(leadAutosave) && leadAutosave.inFlightVersion === null && (leadAutosave.status === 'error' || !!leadSaveBlockedReason);
                    return (
                      <div className="flex items-center gap-2 text-xs" data-testid="lead-autosave-status" aria-live="polite">
                        {leadAutosave.inFlightVersion !== null || (!failed && hasUnsavedChanges(leadAutosave)) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-green-600" />
                        ) : failed ? (
                          <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        )}
                        <span className={failed ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground'}>{label}</span>
                        {failed && leadAutosave.status === 'error' && !leadSaveBlockedReason && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={retryLeadConfigSave} data-testid="button-lead-retry-save">
                            Retry
                          </Button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Stored config failed validation: shown as the chat uses it, with a warning. */}
                {leadConfigMeta?.warning && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200" data-testid="lead-config-stored-warning">
                    <p className="font-medium flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{leadConfigMeta.warning.message}</p>
                    {[...leadConfigMeta.warning.issues, ...leadConfigMeta.warning.repairs].length > 0 && (
                      <ul className="mt-1 list-disc pl-5 space-y-0.5">
                        {[...leadConfigMeta.warning.issues, ...leadConfigMeta.warning.repairs].map((t, i) => <li key={i}>{t}</li>)}
                      </ul>
                    )}
                  </div>
                )}
                {/* Legacy values migrated for display (e.g. old "At End" timing). */}
                {!!leadConfigMeta?.notes?.length && (
                  <LeadWarningList warnings={leadConfigMeta.notes.map((n) => ({ level: 'warn' as const, message: n, code: 'legacy-note' }))} />
                )}
                {/* Nothing saved yet: these are defaults the chat is not using. */}
                {leadConfigMeta?.source === 'default' && !hasUnsavedChanges(leadAutosave) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20 px-3 py-2 text-xs text-blue-900 dark:text-blue-200" data-testid="lead-config-defaults-info">
                    <span>Lead capture isn't set up yet — these are the suggested defaults. Chroney starts using them once you save or change a setting.</span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { markLeadConfigEdited(); setLeadConfig((prev) => ({ ...prev })); }} data-testid="button-lead-save-defaults">
                      Save these settings
                    </Button>
                  </div>
                )}

                {/* Same fields drive WhatsApp and Instagram/Facebook DMs. */}
                <p className="text-xs text-muted-foreground flex items-start gap-1.5" data-testid="lead-config-channels-info">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    These fields also drive WhatsApp AI replies when "Use Lead Training" is on in{" "}
                    <Link href={SETTINGS_PATHS.whatsappFlowSettings} className="underline hover:text-foreground">WhatsApp flow settings</Link>{" "}
                    (Mobile and WhatsApp are skipped there — WhatsApp already has the number), and Instagram/Facebook DM replies use them too.
                    Mobile verification (OTP/CAPTCHA) runs on the website widget only.
                  </span>
                </p>

                {/* Account-wide warnings (no fields on, Mobile + WhatsApp both on). */}
                <LeadWarningList warnings={leadWarnings.filter((w) => !w.fieldId)} />

                {/* Contact Fields List with Integrated Timing Settings */}
                <div className="space-y-3">
                  {[...leadConfig.fields].sort((a, b) => a.priority - b.priority).map((field, index, sortedArray) => (
                    <div 
                      key={field.id}
                      className={`rounded-lg border transition-all duration-200 ${
                        field.enabled
                          ? 'bg-white dark:bg-gray-900 border-green-200 dark:border-green-900/50'
                          : 'bg-gray-50/50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      {/* Main Field Row — on narrow screens the controls
                          (Mandatory/Optional, digit check) wrap onto their own
                          line under the label instead of squeezing it. */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3" data-testid={`lead-field-row-${field.id}`}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {/* Priority Arrows */}
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleMoveFieldUp(field.id)}
                              disabled={index === 0}
                              className="h-5 w-5 p-0 hover:bg-green-50 dark:hover:bg-green-950/20 disabled:opacity-30"
                              title="Move up"
                              data-testid={`button-move-up-${field.id}`}
                            >
                              <ChevronUp className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleMoveFieldDown(field.id)}
                              disabled={index === sortedArray.length - 1}
                              className="h-5 w-5 p-0 hover:bg-green-50 dark:hover:bg-green-950/20 disabled:opacity-30"
                              title="Move down"
                              data-testid={`button-move-down-${field.id}`}
                            >
                              <ChevronDown className="w-3 h-3" />
                            </Button>
                          </div>

                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            id={`field-check-${field.id}`}
                            data-testid={`checkbox-field-${field.id}`}
                            checked={field.enabled}
                            onChange={() => handleFieldToggle(field.id)}
                            className="w-4 h-4 shrink-0 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                          />

                          {/* Icon */}
                          <div className={`shrink-0 transition-all duration-200 ${field.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                            {getFieldIcon(field.id)}
                          </div>

                          {/* Field Label */}
                          <Label
                            htmlFor={`field-check-${field.id}`}
                            className={`flex-1 min-w-0 truncate text-sm font-medium cursor-pointer transition-all duration-200 ${
                              field.enabled ? 'text-foreground' : 'text-muted-foreground'
                            }`}
                          >
                            {getFieldLabel(field.id)}
                          </Label>
                        </div>

                        {field.enabled && (
                          <div className="flex flex-wrap items-center gap-2 basis-full sm:basis-auto pl-8 sm:pl-0">
                            {/* Required/Optional Toggle Buttons */}
                            <div className="flex items-center gap-1 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg">
                              <button
                                onClick={() => {
                                  if (!field.required) handleRequiredToggle(field.id);
                                }}
                                data-testid={`button-mandatory-${field.id}`}
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
                                data-testid={`button-optional-${field.id}`}
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

                            {/* Phone Validation Dropdown - mobile/whatsapp only */}
                            {(field.id === 'mobile' || field.id === 'whatsapp') && (
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
                        )}
                      </div>

                      {/* Field-specific warnings (e.g. Keyword timing with no keywords). */}
                      {field.enabled && (
                        <LeadWarningList
                          className="mx-3 mb-2"
                          warnings={leadWarnings.filter((w) => w.fieldId === field.id && w.code !== 'otp_no_channel')}
                        />
                      )}

                      {/* Verification block — mobile field only. Admins pick the
                          method: None, OTP (SMS/WhatsApp), or CAPTCHA (reCAPTCHA
                          v2); mutually exclusive. Website widget only. With "At
                          Start" it is a pre-chat gate; with any other timing it
                          runs when the number is captured mid-chat (see
                          server/services/otp/index.ts + chatService autoDetect). */}
                      {field.enabled && field.id === 'mobile' && (() => {
                        const verificationMethod: 'none' | 'otp' | 'captcha' =
                          field.captchaEnabled ? 'captcha' : field.otpEnabled ? 'otp' : 'none';
                        return (
                        <div
                          data-testid={`otp-controls-${field.id}`}
                          className="mx-3 mb-3 rounded-md border border-purple-200/60 dark:border-purple-900/40 bg-purple-50/40 dark:bg-purple-950/10"
                        >
                          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-purple-200/40 dark:border-purple-900/30">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <ShieldCheck className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                              <span className="text-xs font-medium text-purple-900 dark:text-purple-200">Verification</span>
                            </div>
                            <Link
                              href={SETTINGS_PATHS.otp}
                              data-testid={`link-otp-settings-${field.id}`}
                              className="text-[11px] inline-flex items-center gap-1 text-purple-700 dark:text-purple-300 hover:underline shrink-0"
                            >
                              <Settings2 className="w-3 h-3" />
                              OTP settings
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          </div>

                          {/* Method picker */}
                          <div className="px-3 py-2.5 border-b border-purple-200/40 dark:border-purple-900/30">
                            <Label className="text-xs font-medium">Verification method</Label>
                            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug mb-2" data-testid="text-verification-help">
                              Checks the mobile number on the website chat (not on WhatsApp, Instagram or Facebook).
                              {" "}With <strong>At Start</strong>, visitors verify before the chat begins.
                              {" "}With any other timing, the check runs when the visitor shares their number mid-chat:
                              {" "}<strong>OTP</strong> sends a 6-digit code and the lead goes to your CRM only once it's verified;
                              {" "}<strong>CAPTCHA</strong> shows an "I'm not a robot" check before the chat continues.
                              {" "}"Only count verified leads" needs OTP with At Start.
                            </p>
                            <RadioGroup
                              value={verificationMethod}
                              onValueChange={(v) => handleVerificationMethodChange(field.id, v as 'none' | 'otp' | 'captcha')}
                              className="flex flex-wrap gap-3"
                            >
                              <div className="flex items-center space-x-1.5">
                                <RadioGroupItem value="none" id={`verif-none-${field.id}`} className="h-3.5 w-3.5" data-testid={`radio-verif-none-${field.id}`} />
                                <Label htmlFor={`verif-none-${field.id}`} className="text-xs cursor-pointer">None</Label>
                              </div>
                              <div className="flex items-center space-x-1.5">
                                <RadioGroupItem value="otp" id={`verif-otp-${field.id}`} className="h-3.5 w-3.5" disabled={!msg91Configured && !field.otpDemoMode} data-testid={`radio-verif-otp-${field.id}`} />
                                <Label htmlFor={`verif-otp-${field.id}`} className={`text-xs cursor-pointer ${(!msg91Configured && !field.otpDemoMode) ? 'text-muted-foreground' : ''}`}>OTP (SMS/WhatsApp)</Label>
                              </div>
                              <div className="flex items-center space-x-1.5">
                                <RadioGroupItem value="captcha" id={`verif-captcha-${field.id}`} className="h-3.5 w-3.5" data-testid={`radio-verif-captcha-${field.id}`} />
                                <Label htmlFor={`verif-captcha-${field.id}`} className="text-xs cursor-pointer">CAPTCHA (reCAPTCHA v2)</Label>
                              </div>
                            </RadioGroup>
                            {verificationMethod === 'otp' && otpChannelReady === false && !field.otpDemoMode ? (
                              // OTP chosen but nothing can send a code: saving is
                              // paused (and the server refuses it) until fixed.
                              <div className="mt-2 rounded-md border border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20 px-2.5 py-2" data-testid={`otp-no-channel-${field.id}`}>
                                <p className="text-[11px] text-red-800 dark:text-red-200 leading-snug">
                                  <strong>OTP can't work yet:</strong> no SMS or WhatsApp sender is set up for your OTP channel preference, so visitors would never get a code and their phone leads would stay unverified. This isn't saved until you fix it.
                                </p>
                                <div className="mt-1.5 flex flex-wrap gap-2">
                                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => handleVerificationMethodChange(field.id, 'none')} data-testid={`button-otp-switch-none-${field.id}`}>
                                    Switch to None
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => handleOtpDemoModeToggle(field.id)} data-testid={`button-otp-use-demo-${field.id}`}>
                                    Use Sample OTP
                                  </Button>
                                  <Link href={SETTINGS_PATHS.otp} className="text-[11px] inline-flex items-center gap-1 text-red-800 dark:text-red-200 underline">
                                    Set up a sender
                                  </Link>
                                </div>
                              </div>
                            ) : !msg91Configured && !field.otpDemoMode && (
                              <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-2">
                                Configure at least one OTP delivery channel (SMS or WhatsApp, matching your channel preference) to enable real OTP — or turn on Sample OTP below to demo the flow without any setup.
                              </p>
                            )}
                            {/* Demo / Sample OTP toggle — switch OTP on for client
                                demos with no provider. Accepts a fixed code. */}
                            <div className="mt-2 flex items-start justify-between gap-3 rounded-md border border-amber-300/60 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/10 px-2.5 py-2">
                              <div className="min-w-0">
                                <Label htmlFor={`switch-otp-demo-${field.id}`} className="text-xs font-medium cursor-pointer">
                                  Sample / Demo OTP (no SMS setup)
                                </Label>
                                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                  Switch OTP on for client demos with no provider. The widget accepts the fixed code <strong>111111</strong> and no SMS/WhatsApp is sent.
                                </p>
                              </div>
                              <Switch
                                id={`switch-otp-demo-${field.id}`}
                                data-testid={`switch-otp-demo-${field.id}`}
                                checked={!!field.otpDemoMode}
                                onCheckedChange={() => handleOtpDemoModeToggle(field.id)}
                              />
                            </div>
                          </div>

                          {/* OTP sub-section */}
                          {verificationMethod === 'otp' && (
                            <>
                              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-purple-200/40 dark:border-purple-900/30">
                                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                  <span
                                    data-testid={`pill-otp-sms-${field.id}`}
                                    className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                                      smsConfigured
                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                    }`}
                                  >
                                    SMS: {smsConfigured ? "Ready" : "Off"}
                                  </span>
                                  <span
                                    data-testid={`pill-otp-whatsapp-${field.id}`}
                                    className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                                      whatsappConfigured
                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                    }`}
                                  >
                                    WhatsApp: {whatsappConfigured ? "Ready" : "Off"}
                                  </span>
                                </div>
                              </div>
                              {field.otpDemoMode ? (
                                <div
                                  data-testid={`otp-demo-warning-${field.id}`}
                                  className="mx-3 my-2.5 rounded-md border border-amber-400/70 dark:border-amber-700/50 bg-amber-100/70 dark:bg-amber-950/20 px-3 py-2"
                                >
                                  <p className="text-[11px] text-amber-900 dark:text-amber-200 leading-snug">
                                    <strong>Demo mode is ON.</strong> Verification accepts the fixed code <strong>111111</strong> and no real SMS/WhatsApp is sent. This is insecure — use it only to demo the flow, never for real lead verification.
                                  </p>
                                </div>
                              ) : (
                                <div className="px-3 py-2.5">
                                  <p className="text-[11px] text-muted-foreground leading-snug">
                                    Chroney sends a 6-digit code to confirm the mobile number before saving the lead to your CRM. Choose SMS, WhatsApp, or both in the OTP settings.
                                  </p>
                                </div>
                              )}
                              {/* "Only count verified leads" — depends on OTP being effectively available (real provider OR demo mode). */}
                              {(msg91Configured || field.otpDemoMode) && field.captureStrategy === 'start' && (
                                <div className="flex items-start justify-between gap-3 px-3 py-2.5 border-t border-purple-200/40 dark:border-purple-900/30">
                                  <div className="min-w-0">
                                    <Label
                                      htmlFor={`switch-otp-count-${field.id}`}
                                      className="text-xs font-medium cursor-pointer"
                                    >
                                      Only count verified leads
                                    </Label>
                                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                      When ON, conversations and leads only appear in analytics after the visitor verifies their mobile. Unverified ones are dropped by background cleanup.
                                    </p>
                                  </div>
                                  <Switch
                                    id={`switch-otp-count-${field.id}`}
                                    data-testid={`switch-otp-count-${field.id}`}
                                    checked={!!field.otpRequiredForCounting}
                                    onCheckedChange={() => handleOtpRequiredForCountingToggle(field.id)}
                                  />
                                </div>
                              )}
                            </>
                          )}

                          {/* CAPTCHA sub-section */}
                          {verificationMethod === 'captcha' && (
                            <>
                              <div className="px-3 py-2.5 border-b border-purple-200/40 dark:border-purple-900/30 space-y-2.5">
                                <div>
                                  <Label htmlFor={`captcha-site-key-${field.id}`} className="text-xs font-medium">
                                    reCAPTCHA v2 site key
                                  </Label>
                                  <Input
                                    id={`captcha-site-key-${field.id}`}
                                    data-testid={`input-captcha-site-key-${field.id}`}
                                    value={field.captchaSiteKey || ''}
                                    onChange={(e) => handleCaptchaSiteKeyChange(field.id, e.target.value)}
                                    placeholder="6Lc... (public site key)"
                                    className="mt-1 h-8 text-xs"
                                  />
                                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                    The public site key from your Google reCAPTCHA v2 ("I'm not a robot") admin console. Safe to expose to visitors.
                                  </p>
                                </div>
                                <div>
                                  <Label htmlFor={`captcha-secret-key-${field.id}`} className="text-xs font-medium">
                                    reCAPTCHA v2 secret key
                                    {captchaSecretConfigured && (
                                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                        Configured{captchaSettings?.secretKeyMasked ? `: ${captchaSettings.secretKeyMasked}` : ''}
                                      </span>
                                    )}
                                  </Label>
                                  <div className="flex items-center gap-2 mt-1">
                                    <Input
                                      id={`captcha-secret-key-${field.id}`}
                                      data-testid={`input-captcha-secret-key-${field.id}`}
                                      type="password"
                                      value={captchaSecretDraft}
                                      onChange={(e) => setCaptchaSecretDraft(e.target.value)}
                                      placeholder={captchaSecretConfigured ? 'Enter a new key to rotate' : 'Enter secret key'}
                                      className="h-8 text-xs"
                                    />
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-8 text-xs shrink-0"
                                      data-testid={`button-save-captcha-secret-${field.id}`}
                                      disabled={!captchaSecretDraft.trim() || captchaSecretMutation.isPending}
                                      onClick={() => captchaSecretMutation.mutate(captchaSecretDraft.trim())}
                                    >
                                      {captchaSecretMutation.isPending ? 'Saving…' : 'Save key'}
                                    </Button>
                                  </div>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                    Stored encrypted and never shown again. Visitors who fail the challenge are still saved (as unverified) and the chat stays locked until they pass.
                                  </p>
                                  {!captchaSecretConfigured && (
                                    <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                                      Add the secret key to activate CAPTCHA verification.
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                                <div className="min-w-0">
                                  <Label
                                    htmlFor={`switch-send-unverified-${field.id}`}
                                    className="text-xs font-medium cursor-pointer"
                                  >
                                    Send unverified leads to CRM
                                  </Label>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                    When ON, mobile numbers that failed CAPTCHA are still pushed to your CRM (flagged as unverified). Off by default.
                                  </p>
                                </div>
                                <Switch
                                  id={`switch-send-unverified-${field.id}`}
                                  data-testid={`switch-send-unverified-${field.id}`}
                                  checked={!!field.sendUnverifiedLeadsToCrm}
                                  onCheckedChange={() => handleSendUnverifiedToggle(field.id)}
                                />
                              </div>
                            </>
                          )}
                        </div>
                        );
                      })()}

                      {/* Timing Settings - Inside the card when enabled (shared with the group editor) */}
                      {field.enabled && (
                        <div className="px-3 pb-3 pt-0">
                          <LeadTimingSettings
                            field={field}
                            onStrategyChange={(s) => handleStrategyChange(field.id, s)}
                            onAskAfterChange={(n) => handleCustomAskAfterChange(field.id, n)}
                            onIntensityChange={(lvl) => handleIntentIntensityChange(field.id, lvl)}
                            onKeywordsChange={(kws) => handleKeywordsChange(field.id, kws)}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Helper text */}
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ChevronUp className="w-3 h-3" />
                  <ChevronDown className="w-3 h-3" />
                  <span>Use arrows to set collection priority</span>
                </p>

                {/* Conversion tracking (Google Ads) */}
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  <div>
                    <Label htmlFor="conversion-url" className="text-sm font-medium">
                      Conversion tracking page (Google Ads)
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      When a visitor's mobile number is captured, the widget silently loads this https
                      "thank-you" page in the visitor's browser so your Google Ads conversion tag fires.
                      Fires once per conversation. Leave blank to disable. The page is never opened
                      server-side.
                    </p>
                  </div>
                  <Input
                    id="conversion-url"
                    type="url"
                    inputMode="url"
                    placeholder="https://yoursite.com/thank-you"
                    value={leadConfig.conversionUrl || ''}
                    onChange={(e) => handleConversionUrlChange(e.target.value)}
                    className={conversionUrlInvalid ? 'border-destructive focus-visible:ring-destructive' : ''}
                    data-testid="input-conversion-url"
                  />
                  {conversionUrlInvalid && (
                    <p className="text-xs text-destructive">
                      Enter a valid https URL (e.g. https://yoursite.com/thank-you).
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div>
                      <Label htmlFor="conversion-badge" className="text-sm cursor-pointer">
                        Show "Thank-you page fired" badge
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Displays a small confirmation badge (with the URL) in the corner of the widget
                        when the page fires. Useful for testing.
                      </p>
                    </div>
                    <Switch
                      id="conversion-badge"
                      checked={!!leadConfig.conversionBadgeEnabled}
                      onCheckedChange={handleConversionBadgeToggle}
                      disabled={!(leadConfig.conversionUrl || '').trim() || conversionUrlInvalid}
                      data-testid="switch-conversion-badge"
                    />
                  </div>
                </div>

                {/* Auto-save status (repeated at the bottom, next to the last settings) */}
                {autosaveLabel(leadAutosave, leadSaveBlockedReason) && (
                  <div className="flex flex-wrap justify-end items-center gap-2 pt-2 text-xs" aria-live="polite">
                    <span className={leadAutosave.status === 'error' || leadSaveBlockedReason ? (hasUnsavedChanges(leadAutosave) ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground') : 'text-muted-foreground'}>
                      {autosaveLabel(leadAutosave, leadSaveBlockedReason)}
                    </span>
                    {leadAutosave.status === 'error' && hasUnsavedChanges(leadAutosave) && leadAutosave.inFlightVersion === null && !leadSaveBlockedReason && (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={retryLeadConfigSave}>
                        Retry
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

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
              <AlertDialogCancel onClick={handleCancelDelete}>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleConfirmDelete}
                className="bg-red-600 hover:bg-red-700"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Instruction</DialogTitle>
              <DialogDescription>
                Make changes to your instruction below
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 rounded-t-lg border border-b-0">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => applyFormatting('bold', true)}
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
                        onClick={() => applyFormatting('italic', true)}
                        className="h-7 w-7 p-0"
                      >
                        <Italic className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Italic</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Textarea
                ref={editTextareaRef}
                value={editText}
                onChange={(e) => {
                  setEditText(e.target.value);
                  // Auto-expand textarea
                  const textarea = e.target;
                  textarea.style.height = 'auto';
                  textarea.style.height = `${textarea.scrollHeight}px`;
                }}
                onFocus={(e) => {
                  // Auto-expand on focus in case content was loaded
                  const textarea = e.target;
                  textarea.style.height = 'auto';
                  textarea.style.height = `${textarea.scrollHeight}px`;
                }}
                className="min-h-[120px] rounded-t-none border-t-0 resize-none overflow-hidden"
                rows={5}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelEdit}>
                Cancel
              </Button>
              <Button 
                onClick={handleSaveEdit}
                disabled={!editText.trim()}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* AI Refine Dialog */}
        <Dialog open={refineDialogOpen} onOpenChange={setRefineDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                AI-Refined Instruction
              </DialogTitle>
              <DialogDescription>
                Review the AI-improved version of your instruction
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Original</label>
                <div className="p-3 bg-muted/30 rounded-lg text-sm">
                  {originalInstruction}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Refined</label>
                <div className="p-3 bg-purple-50/50 dark:bg-purple-950/20 rounded-lg text-sm border border-purple-100 dark:border-purple-900/30">
                  {refinedInstruction}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelRefine}>
                Cancel
              </Button>
              <Button 
                onClick={handleApplyRefinedInstruction}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                <Check className="w-4 h-4 mr-1" />
                Use Refined Version
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* AI Analysis Dialog */}
        <Dialog open={analysisDialogOpen} onOpenChange={setAnalysisDialogOpen}>
          <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-purple-600" />
                AI Instruction Analysis
              </DialogTitle>
              <DialogDescription>
                Review conflicts, suggestions, and improvements for your training instructions
              </DialogDescription>
            </DialogHeader>
            
            {isAnalyzing ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-purple-600 mb-4" />
                <p className="text-sm text-muted-foreground">Analyzing your instructions...</p>
              </div>
            ) : analysisResult && (
              <div className="space-y-6 py-4">
                {/* Quality Score Header */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 rounded-lg border">
                    <div>
                      <h3 className="font-semibold text-lg mb-1">Quality Score</h3>
                      <p className="text-sm text-muted-foreground">{analysisResult.summary}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <TrendingUp className={`w-5 h-5 ${analysisResult.qualityScore >= 80 ? 'text-green-600' : analysisResult.qualityScore >= 60 ? 'text-amber-600' : 'text-red-600'}`} />
                      <span className={`text-3xl font-bold ${analysisResult.qualityScore >= 80 ? 'text-green-600' : analysisResult.qualityScore >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                        {analysisResult.qualityScore}
                      </span>
                      <span className="text-muted-foreground">/100</span>
                    </div>
                  </div>
                  
                  {/* Score Tier Explanation */}
                  <div className="p-3 bg-muted/30 rounded-lg border">
                    <div className="flex items-start gap-2 mb-2">
                      <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="text-xs space-y-1">
                        <p className="font-semibold text-foreground">Score Guide:</p>
                        <div className="grid grid-cols-1 gap-1">
                          <div className="flex items-center gap-2">
                            <span className="text-green-600 dark:text-green-400 font-semibold">90-100:</span>
                            <span className="text-muted-foreground">Excellent - No significant issues</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-green-600 dark:text-green-400 font-semibold">80-89:</span>
                            <span className="text-muted-foreground">Very Good - Minor refinements possible</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">70-79:</span>
                            <span className="text-muted-foreground">Good - Some improvements recommended</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-red-600 dark:text-red-400 font-semibold">&lt;70:</span>
                            <span className="text-muted-foreground">Needs Work - Conflicts detected</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Conflicts Section */}
                {analysisResult.conflicts && analysisResult.conflicts.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                      Conflicts Detected ({analysisResult.conflicts.length})
                    </h3>
                    <div className="space-y-3">
                      {analysisResult.conflicts.map((conflict: any, idx: number) => (
                        <div key={idx} className={`p-4 rounded-lg border ${getSeverityBg(conflict.severity)}`}>
                          <div className="flex items-start justify-between mb-2">
                            <span className={`text-xs font-semibold uppercase ${getSeverityColor(conflict.severity)}`}>
                              {conflict.severity} Severity
                            </span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-white/50 dark:bg-black/20">
                              {conflict.type.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <p className="text-sm font-medium mb-2">{conflict.description}</p>
                          <div className="mt-3 p-3 bg-white/60 dark:bg-black/20 rounded border border-dashed">
                            <p className="text-xs font-semibold text-muted-foreground mb-1">Suggested Fix:</p>
                            <p className="text-sm">{conflict.suggestedFix}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}


                {/* Refinements Section */}
                {analysisResult.refinements && analysisResult.refinements.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-purple-600" />
                      Suggested Refinements ({selectedRefinements.size} selected)
                    </h3>
                    <div className="space-y-3">
                      {analysisResult.refinements.map((refinement: any) => (
                        <div key={refinement.instructionId} className="p-4 rounded-lg border bg-purple-50/50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900/30">
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={selectedRefinements.has(refinement.instructionId)}
                              onChange={(e) => {
                                const newSet = new Set(selectedRefinements);
                                if (e.target.checked) {
                                  newSet.add(refinement.instructionId);
                                } else {
                                  newSet.delete(refinement.instructionId);
                                }
                                setSelectedRefinements(newSet);
                              }}
                              className="mt-1 w-4 h-4 rounded border-purple-300"
                            />
                            <div className="flex-1 space-y-3">
                              <div>
                                <label className="text-xs font-semibold text-muted-foreground mb-1 block">Original</label>
                                <div className="p-2 bg-white/60 dark:bg-black/20 rounded text-sm">
                                  {refinement.originalText}
                                </div>
                              </div>
                              <div>
                                <label className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1 block">Refined</label>
                                <div className="p-2 bg-purple-100/50 dark:bg-purple-900/30 rounded text-sm border border-purple-200 dark:border-purple-800">
                                  {refinement.refinedText}
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground">{refinement.reason}</p>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <span>Confidence:</span>
                                <span className="font-semibold">{Math.round(refinement.confidence * 100)}%</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty State */}
                {(!analysisResult.conflicts || analysisResult.conflicts.length === 0) &&
                 (!analysisResult.refinements || analysisResult.refinements.length === 0) && (
                  <div className="text-center py-12">
                    <Check className="w-16 h-16 text-green-600 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-green-600 mb-2">All Clear!</h3>
                    <p className="text-sm text-muted-foreground">
                      Your instructions look great. No conflicts or improvements detected.
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Note: Core conversation best practices (checking history, extracting contact info, acknowledging shared information) are built into Chroney and always followed automatically.
                    </p>
                  </div>
                )}
              </div>
            )}
            
            <DialogFooter>
              <div className="flex items-center justify-between w-full">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setAnalysisDialogOpen(false);
                    setAnalysisResult(null);
                    setSelectedRefinements(new Set());
                  }}
                >
                  Close
                </Button>
                <div className="flex gap-2">
                  {analysisResult && (
                    <>
                      {/* Apply All Fixes Button */}
                      {analysisResult.refinements?.length > 0 && (
                        <Button 
                          onClick={handleApplyAllFixes}
                          variant="outline"
                          className="gap-2"
                        >
                          <Sparkles className="w-4 h-4" />
                          Apply All Refinements
                        </Button>
                      )}
                      
                      {/* Apply Selected Button */}
                      {selectedRefinements.size > 0 && (
                        <Button 
                          onClick={handleApplyAnalysis}
                          className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                        >
                          <Check className="w-4 h-4 mr-1" />
                          Apply Selected ({selectedRefinements.size})
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
