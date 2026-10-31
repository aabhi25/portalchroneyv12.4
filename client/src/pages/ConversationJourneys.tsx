import { brandShort } from "@/lib/brand";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { JourneyBuilder } from "@/components/journeys/JourneyBuilder";
import { NewJourneyDialog } from "@/components/journeys/NewJourneyDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Switch } from "@/components/ui/switch";
import TrainingNavTabs from "@/components/TrainingNavTabs";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Plus,
  Trash2,
  Edit2,
  GripVertical,
  Play,
  Save,
  BookOpen,
  Target,
  Calendar,
  ShoppingBag,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  X,
  Settings2,
  GitBranch,
  ArrowRight,
  Check,
  FileText,
  Sparkles,
  Loader2,
  Bold,
  Italic,
  SkipForward,
  Diamond,
  CircleDot,
  ArrowDown,
  Copy,
} from "lucide-react";

interface Journey {
  id: string;
  businessAccountId: string;
  name: string;
  description?: string;
  templateType: string;
  journeyType?: string; // 'conversational' | 'form'
  status: string;
  isDefault: string;
  triggerMode: string;
  triggerKeywords?: string;
  startFromScratch?: string;
  endMode?: string; // 'chat' | 'end' - after the last question: carry on with the AI, or end the chat
  conversationalGuidelines?: string;
  createdAt: string;
  updatedAt: string;
}

interface Instruction {
  id: string;
  text: string;
}

interface JourneyStep {
  id: string;
  journeyId: string;
  questionText: string;
  questionType: string;
  isRequired: string;
  stepOrder: number;
  toolTrigger?: string;
  branchingCondition?: string | null;
  multipleChoiceOptions?: string | null;
  exitOnValue?: string | null;
  exitMessage?: string | null;
  skipOnValue?: string | null;
  skipToStepIndex?: number | null;
  isConditional?: string | null;
  completionButtonText?: string | null;
  crmFieldKey?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BranchRoute {
  matchType: 'contains' | 'exact' | 'regex' | 'any';
  matchValue: string;
  targetStepId: string;
  label: string;
}

interface JourneyWithSteps extends Journey {
  steps?: JourneyStep[];
}

// Journey type options
const JOURNEY_TYPES = [
  {
    id: "conversational",
    name: "Conversational Journey",
    icon: MessageSquare,
    journeyType: "conversational",
    description: "AI-guided conversations where questions are asked naturally in chat",
    steps: [],
  },
  {
    id: "form",
    name: "Form Journey",
    icon: FileText,
    journeyType: "form",
    description: "Step-by-step visual forms with input fields, dropdowns, and radio buttons",
    steps: [],
  },
];

const FIELD_TYPES = [
  { value: "text", label: "Text Input" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "dropdown", label: "Dropdown" },
  { value: "radio", label: "Radio Buttons" },
];

const TOOL_TRIGGERS = [
  { value: "none", label: "None" },
  { value: "capture_lead", label: "Capture Lead" },
  { value: "book_appointment", label: "Book Appointment" },
  { value: "get_products", label: "Get Products" },
  { value: "get_faqs", label: "Get FAQs" },
  { value: "journey_complete", label: "Journey Complete" },
];

export default function ConversationJourneys() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);
  // The journey list can be folded into a thin strip on wide screens (remembered per browser).
  const [listCollapsed, setListCollapsed] = useState(() => {
    try { return localStorage.getItem("journeys:listCollapsed") === "1"; } catch { return false; }
  });
  const toggleList = () => setListCollapsed(c => {
    try { localStorage.setItem("journeys:listCollapsed", c ? "0" : "1"); } catch { /* storage unavailable */ }
    return !c;
  });
  const [isEditing, setIsEditing] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [journeyToDelete, setJourneyToDelete] = useState<string | null>(null);
  const [editingStep, setEditingStep] = useState<JourneyStep | null>(null);
  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const [journeyMapOpen, setJourneyMapOpen] = useState(false);
  const [editingJourneyName, setEditingJourneyName] = useState(false);
  const [editedJourneyName, setEditedJourneyName] = useState("");
  const [editingJourneyDescription, setEditingJourneyDescription] = useState(false);
  const [editedJourneyDescription, setEditedJourneyDescription] = useState("");
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [scriptInput, setScriptInput] = useState("");
  const [parsedScriptData, setParsedScriptData] = useState<any>(null);
  const [isParsingScript, setIsParsingScript] = useState(false);
  const [showScriptPreview, setShowScriptPreview] = useState(false);
  const [editingGuidelines, setEditingGuidelines] = useState(false);
  const [editedGuidelines, setEditedGuidelines] = useState("");
  const [duplicatingJourneyId, setDuplicatingJourneyId] = useState<string | null>(null);
  
  // Journey-specific training instructions state
  const [journeyInstructions, setJourneyInstructions] = useState<Instruction[]>([]);
  const [editingInstructionId, setEditingInstructionId] = useState<string | null>(null);
  const [editInstructionText, setEditInstructionText] = useState("");
  const [newJourneyInstruction, setNewJourneyInstruction] = useState("");
  const [deleteInstructionDialogOpen, setDeleteInstructionDialogOpen] = useState(false);
  const [instructionToDelete, setInstructionToDelete] = useState<string | null>(null);
  const [refineInstructionDialogOpen, setRefineInstructionDialogOpen] = useState(false);
  const [isRefiningInstruction, setIsRefiningInstruction] = useState(false);
  const [originalInstructionText, setOriginalInstructionText] = useState("");
  const [refinedInstructionText, setRefinedInstructionText] = useState("");

  const [journeyForm, setJourneyForm] = useState({
    name: "",
    description: "",
    templateType: "",
    status: "active" as const,
    isDefault: "false" as const,
    triggerMode: "manual" as const,
  });

  const [stepForm, setStepForm] = useState({
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
    crmFieldKey: "",
  });
  
  const [branchRoutes, setBranchRoutes] = useState<BranchRoute[]>([]);
  const [defaultNextStepId, setDefaultNextStepId] = useState<string | null>(null);
  const [newRoute, setNewRoute] = useState<{
    matchType: 'contains' | 'exact' | 'regex' | 'any';
    matchValue: string;
    targetStepId: string;
    label: string;
  }>({
    matchType: 'contains',
    matchValue: '',
    targetStepId: '',
    label: '',
  });

  const { data: journeys, isLoading } = useQuery<Journey[]>({
    queryKey: ["/api/journeys"],
  });

  const { data: selectedJourney, isLoading: isLoadingJourney } = useQuery<JourneyWithSteps>({
    queryKey: ["/api/journeys", selectedJourneyId],
    queryFn: async () => {
      if (!selectedJourneyId) return null;
      const response = await fetch(`/api/journeys/${selectedJourneyId}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch journey");
      return response.json();
    },
    enabled: !!selectedJourneyId,
  });

  const sortedSteps = useMemo(() => {
    if (!selectedJourney?.steps) return [];
    return [...selectedJourney.steps].sort((a, b) => a.stepOrder - b.stepOrder);
  }, [selectedJourney?.steps]);

  const parsedTriggerKeywords = useMemo(() => {
    if (!selectedJourney?.triggerKeywords) return [];
    try {
      return JSON.parse(selectedJourney.triggerKeywords) as string[];
    } catch {
      return [];
    }
  }, [selectedJourney?.triggerKeywords]);

  // "When does it start?": keywords can be chosen before any keyword is typed, so it's kept here.
  const [startMode, setStartMode] = useState<'open' | 'mentions' | 'menu'>('menu');
  useEffect(() => {
    if (!selectedJourney) return;
    setStartMode(selectedJourney.startFromScratch === 'true' ? 'open' : parsedTriggerKeywords.length > 0 ? 'mentions' : 'menu');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJourney?.id]);

  const loadJourneyWithSteps = useCallback((journeyId: string) => {
    setSelectedJourneyId(journeyId);
  }, []);

  const handleJourneyHover = useCallback((journeyId: string) => {
    queryClient.prefetchQuery({
      queryKey: ["/api/journeys", journeyId],
      queryFn: async () => {
        const response = await fetch(`/api/journeys/${journeyId}`, { credentials: "include" });
        if (!response.ok) throw new Error("Failed to fetch journey");
        return response.json();
      }
    });
  }, [queryClient]);

  const createJourneyMutation = useMutation({
    mutationFn: async (data: typeof journeyForm) => {
      const response = await fetch("/api/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create journey");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      toast({ title: "Journey created successfully" });
      setIsEditing(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Failed to create journey", variant: "destructive" });
    },
  });

  const updateJourneyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Journey> }) => {
      const response = await fetch(`/api/journeys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update journey");
      return response.json();
    },
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/journeys", id] });
      const previousJourney = queryClient.getQueryData<JourneyWithSteps>(["/api/journeys", id]);
      
      if (previousJourney) {
        queryClient.setQueryData<JourneyWithSteps>(["/api/journeys", id], {
          ...previousJourney,
          ...data,
        });
      }
      
      const previousJourneys = queryClient.getQueryData<Journey[]>(["/api/journeys"]);
      if (previousJourneys) {
        if (data.isDefault === 'true') {
          queryClient.setQueryData<Journey[]>(
            ["/api/journeys"],
            previousJourneys.map(j => ({
              ...j,
              isDefault: j.id === id ? 'true' : 'false'
            }))
          );
        } else {
          queryClient.setQueryData<Journey[]>(["/api/journeys"], previousJourneys.map(j => 
            j.id === id ? { ...j, ...data } : j
          ));
        }
      }
      
      return { previousJourney, previousJourneys };
    },
    onError: (err, variables, context) => {
      if (context?.previousJourney) {
        queryClient.setQueryData(["/api/journeys", variables.id], context.previousJourney);
      }
      if (context?.previousJourneys) {
        queryClient.setQueryData(["/api/journeys"], context.previousJourneys);
      }
      toast({ title: "Failed to update journey", variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Journey updated successfully" });
    },
  });

  const deleteJourneyMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/journeys/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete journey");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      toast({ title: "Journey deleted successfully" });
      setSelectedJourneyId(null);
    },
    onError: () => {
      toast({ title: "Failed to delete journey", variant: "destructive" });
    },
  });

  const duplicateJourney = async (journeyId: string) => {
    setDuplicatingJourneyId(journeyId);
    try {
      const response = await fetch(`/api/journeys/${journeyId}/duplicate`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to duplicate journey");
      const newJourney = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      toast({ title: "Journey duplicated successfully" });
      loadJourneyWithSteps(newJourney.id);
    } catch (error) {
      toast({ title: "Failed to duplicate journey", variant: "destructive" });
    } finally {
      setDuplicatingJourneyId(null);
    }
  };

  const createStepMutation = useMutation({
    mutationFn: async ({ journeyId, data }: { journeyId: string; data: typeof stepForm }) => {
      const maxOrder = selectedJourney?.steps?.length || 0;
      const response = await fetch(`/api/journeys/${journeyId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...data, stepOrder: String(maxOrder) }),
      });
      if (!response.ok) throw new Error("Failed to create step");
      return response.json();
    },
    onSuccess: (newStep, { journeyId }) => {
      queryClient.setQueryData<JourneyWithSteps>(["/api/journeys", journeyId], (old) => {
        if (!old) return old;
        return {
          ...old,
          steps: [...(old.steps || []), newStep],
        };
      });
      toast({ title: "Step added successfully" });
      setStepDialogOpen(false);
      resetStepForm();
    },
    onError: () => {
      toast({ title: "Failed to add step", variant: "destructive" });
    },
  });

  const updateStepMutation = useMutation({
    mutationFn: async ({ journeyId, stepId, data }: { journeyId: string; stepId: string; data: Partial<JourneyStep> }) => {
      const response = await fetch(`/api/journeys/${journeyId}/steps/${stepId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update step");
      return response.json();
    },
    onSuccess: (updatedStep, { journeyId }) => {
      queryClient.setQueryData<JourneyWithSteps>(["/api/journeys", journeyId], (old) => {
        if (!old) return old;
        return {
          ...old,
          steps: old.steps?.map(s => s.id === updatedStep.id ? updatedStep : s),
        };
      });
      toast({ title: "Step updated successfully" });
      setStepDialogOpen(false);
      setEditingStep(null);
      resetStepForm();
    },
    onError: () => {
      toast({ title: "Failed to update step", variant: "destructive" });
    },
  });

  const deleteStepMutation = useMutation({
    mutationFn: async ({ journeyId, stepId }: { journeyId: string; stepId: string }) => {
      const response = await fetch(`/api/journeys/${journeyId}/steps/${stepId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete step");
      return response.json();
    },
    onSuccess: (_, { journeyId, stepId }) => {
      queryClient.setQueryData<JourneyWithSteps>(["/api/journeys", journeyId], (old) => {
        if (!old) return old;
        return {
          ...old,
          steps: old.steps?.filter(s => s.id !== stepId),
        };
      });
      toast({ title: "Step deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete step", variant: "destructive" });
    },
  });

  const reorderStepsMutation = useMutation({
    mutationFn: async ({ journeyId, stepOrders }: { journeyId: string; stepOrders: { id: string; stepOrder: number }[] }) => {
      const response = await fetch(`/api/journeys/${journeyId}/steps/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ stepOrders }),
      });
      if (!response.ok) throw new Error("Failed to reorder steps");
      return response.json();
    },
    onMutate: async ({ journeyId }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/journeys", journeyId] });
      const previousJourney = queryClient.getQueryData<JourneyWithSteps>(["/api/journeys", journeyId]);
      return { previousJourney };
    },
    onError: (err, { journeyId }, context) => {
      if (context?.previousJourney) {
        queryClient.setQueryData(["/api/journeys", journeyId], context.previousJourney);
      }
      toast({ title: "Failed to reorder steps", variant: "destructive" });
    },
  });

  const handleParseScript = async () => {
    if (!scriptInput.trim()) {
      toast({ title: "Please paste a conversation script", variant: "destructive" });
      return;
    }

    setIsParsingScript(true);
    try {
      const response = await fetch("/api/journeys/parse-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ script: scriptInput }),
      });

      if (!response.ok) throw new Error("Failed to parse script");
      const parsed = await response.json();
      setParsedScriptData(parsed);
      setShowScriptPreview(true);
      setShowImportDialog(false);
    } catch (error) {
      toast({ title: "Failed to parse script", variant: "destructive" });
    } finally {
      setIsParsingScript(false);
    }
  };

  const handleCreateFromScript = async () => {
    if (!parsedScriptData) return;

    try {
      const journeyData = {
        name: parsedScriptData.journeyName,
        description: parsedScriptData.description,
        templateType: 'custom',
        status: 'active',
        isDefault: 'false',
        triggerMode: parsedScriptData.triggerKeywords?.length > 0 ? 'auto' : 'manual',
        triggerKeywords: parsedScriptData.triggerKeywords?.length > 0 ? JSON.stringify(parsedScriptData.triggerKeywords) : null,
        conversationalGuidelines: parsedScriptData.conversationalGuidelines,
      };

      console.log('[Journey Import] Creating journey:', journeyData);
      const journeyResponse = await fetch("/api/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(journeyData),
      });

      if (!journeyResponse.ok) {
        const errorData = await journeyResponse.json();
        throw new Error(errorData.error || "Failed to create journey");
      }
      const createdJourney = await journeyResponse.json();
      console.log('[Journey Import] Journey created:', createdJourney.id);

      // Create steps with proper error handling
      console.log('[Journey Import] Creating', parsedScriptData.steps.length, 'steps...');
      for (let i = 0; i < parsedScriptData.steps.length; i++) {
        const step = parsedScriptData.steps[i];
        const stepData = {
          questionText: step.questionText,
          questionType: 'text',
          isRequired: step.isRequired ? 'true' : 'false',
          stepOrder: String(i), // Convert to string for numeric field
          toolTrigger: step.toolTrigger || null,
        };
        
        console.log(`[Journey Import] Creating step ${i + 1}:`, stepData);
        const stepResponse = await fetch(`/api/journeys/${createdJourney.id}/steps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(stepData),
        });
        
        if (!stepResponse.ok) {
          const errorData = await stepResponse.json();
          console.error(`[Journey Import] Failed to create step ${i + 1}:`, errorData);
          throw new Error(`Failed to create step ${i + 1}: ${errorData.error || 'Unknown error'}`);
        }
        
        const createdStep = await stepResponse.json();
        console.log(`[Journey Import] Step ${i + 1} created:`, createdStep.id);
      }

      console.log('[Journey Import] All steps created successfully');
      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      setShowScriptPreview(false);
      setParsedScriptData(null);
      setScriptInput("");
      loadJourneyWithSteps(createdJourney.id);
      toast({ title: "Journey created from script successfully" });
    } catch (error: any) {
      console.error('[Journey Import] Error:', error);
      toast({ 
        title: "Failed to create journey from script", 
        description: error.message,
        variant: "destructive" 
      });
    }
  };

  const resetForm = () => {
    setJourneyForm({
      name: "",
      description: "",
      templateType: "",
      status: "active",
      isDefault: "false",
      triggerMode: "manual",
    });
  };

  const resetStepForm = () => {
    setStepForm({
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
      crmFieldKey: "",
    });
    setBranchRoutes([]);
    setDefaultNextStepId(null);
    setNewRoute({
      matchType: 'contains',
      matchValue: '',
      targetStepId: '',
      label: '',
    });
  };

  // Load journey instructions from conversationalGuidelines field
  useEffect(() => {
    if (!selectedJourney) {
      setJourneyInstructions([]);
      return;
    }

    if (selectedJourney.conversationalGuidelines) {
      try {
        const parsed = JSON.parse(selectedJourney.conversationalGuidelines);
        if (Array.isArray(parsed)) {
          setJourneyInstructions(parsed);
        } else {
          // Legacy format - migrate to array
          setJourneyInstructions([]);
        }
      } catch {
        // Invalid JSON - reset to empty
        setJourneyInstructions([]);
      }
    } else {
      setJourneyInstructions([]);
    }
  }, [selectedJourney?.id, selectedJourney?.conversationalGuidelines]);

  // Auto-save instructions when they change
  useEffect(() => {
    if (!selectedJourneyId || !selectedJourney) return;
    
    const instructionsJSON = JSON.stringify(journeyInstructions);
    
    // Only update if different from saved value
    if (instructionsJSON !== (selectedJourney.conversationalGuidelines || JSON.stringify([]))) {
      const timeoutId = setTimeout(() => {
        updateJourneyMutation.mutate({
          id: selectedJourneyId,
          data: { conversationalGuidelines: instructionsJSON },
        });
      }, 1000); // Debounce 1 second

      return () => clearTimeout(timeoutId);
    }
  }, [journeyInstructions, selectedJourneyId, selectedJourney?.conversationalGuidelines]);

  // Journey instruction management functions
  const handleAddJourneyInstruction = () => {
    if (!newJourneyInstruction.trim()) return;

    const newInstruction: Instruction = {
      id: crypto.randomUUID(),
      text: newJourneyInstruction.trim(),
    };

    setJourneyInstructions([...journeyInstructions, newInstruction]);
    setNewJourneyInstruction("");
    toast({ title: "Instruction added" });
  };

  const handleUpdateJourneyInstruction = (id: string, text: string) => {
    setJourneyInstructions(
      journeyInstructions.map((inst) =>
        inst.id === id ? { ...inst, text: text.trim() } : inst
      )
    );
    setEditingInstructionId(null);
    toast({ title: "Instruction updated" });
  };

  const handleDeleteJourneyInstruction = () => {
    if (!instructionToDelete) return;

    setJourneyInstructions(
      journeyInstructions.filter((inst) => inst.id !== instructionToDelete)
    );
    setInstructionToDelete(null);
    setDeleteInstructionDialogOpen(false);
    toast({ title: "Instruction deleted" });
  };

  const handleRefineJourneyInstruction = async (instruction: Instruction) => {
    setOriginalInstructionText(instruction.text);
    setRefinedInstructionText(instruction.text);
    setRefineInstructionDialogOpen(true);
    setIsRefiningInstruction(true);

    try {
      const response = await fetch("/api/ai/refine-instruction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ instruction: instruction.text }),
      });

      if (!response.ok) throw new Error("Failed to refine instruction");

      const data = await response.json();
      setRefinedInstructionText(data.refined);
      setIsRefiningInstruction(false);
    } catch (error) {
      toast({
        title: "Failed to refine instruction",
        variant: "destructive",
      });
      setRefineInstructionDialogOpen(false);
      setIsRefiningInstruction(false);
    }
  };

  const handleAcceptRefinedInstruction = () => {
    const instructionToUpdate = journeyInstructions.find(
      (inst) => inst.text === originalInstructionText
    );
    if (instructionToUpdate) {
      handleUpdateJourneyInstruction(instructionToUpdate.id, refinedInstructionText);
    }
    setRefineInstructionDialogOpen(false);
  };

  const handleCreateFromTemplate = async (template: typeof JOURNEY_TYPES[0]) => {
    const newJourney = {
      name: template.name,
      description: template.description,
      templateType: template.id,
      journeyType: template.journeyType || 'conversational',
      status: 'active',
      isDefault: 'false',
      triggerMode: 'manual',
    };

    try {
      const response = await fetch("/api/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(newJourney),
      });

      if (!response.ok) throw new Error("Failed to create journey");
      const createdJourney = await response.json();

      for (const step of template.steps) {
        await fetch(`/api/journeys/${createdJourney.id}/steps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            ...step,
            stepOrder: String(step.stepOrder), // Convert to string for numeric field
          }),
        });
      }

      queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
      setShowTemplates(false);
      loadJourneyWithSteps(createdJourney.id);
      toast({ title: "Journey created from template" });
    } catch (error) {
      toast({ title: "Failed to create journey", variant: "destructive" });
    }
  };

  const handleDragStart = (stepId: string) => {
    setDraggedStepId(stepId);
  };

  const handleDragOver = (e: React.DragEvent, targetStepId: string) => {
    e.preventDefault();
    if (!draggedStepId || !selectedJourney?.steps || !selectedJourneyId) return;

    const steps = [...selectedJourney.steps];
    const draggedIndex = steps.findIndex(s => s.id === draggedStepId);
    const targetIndex = steps.findIndex(s => s.id === targetStepId);

    if (draggedIndex === targetIndex) return;

    const [draggedStep] = steps.splice(draggedIndex, 1);
    steps.splice(targetIndex, 0, draggedStep);

    const reorderedSteps = steps.map((step, index) => ({
      ...step,
      stepOrder: index + 1,
    }));

    queryClient.setQueryData<JourneyWithSteps>(["/api/journeys", selectedJourneyId], {
      ...selectedJourney,
      steps: reorderedSteps,
    });
  };

  const handleDragEnd = () => {
    if (!draggedStepId || !selectedJourneyId) return;
    
    // Get the CURRENT (optimistically updated) steps from cache
    const currentJourney = queryClient.getQueryData<JourneyWithSteps>(["/api/journeys", selectedJourneyId]);
    if (!currentJourney || !currentJourney.steps) return;
    
    // Build stepOrders from the cached (already reordered) steps
    const stepOrders = currentJourney.steps.map(step => ({
      id: step.id,
      stepOrder: step.stepOrder,
    }));
    
    // Send the new order to server
    reorderStepsMutation.mutate({
      journeyId: selectedJourneyId,
      stepOrders,
    });

    setDraggedStepId(null);
  };

  const handleEditStep = (step: JourneyStep) => {
    setEditingStep(step);
    let parsedOptions: string[] = [];
    if (step.multipleChoiceOptions) {
      try {
        parsedOptions = JSON.parse(step.multipleChoiceOptions);
      } catch (e) {
        console.error('Failed to parse multiple choice options:', e);
      }
    }
    setStepForm({
      questionText: step.questionText,
      questionType: step.questionType,
      isRequired: step.isRequired,
      toolTrigger: step.toolTrigger || "none",
      multipleChoiceOptions: parsedOptions,
      exitOnValue: step.exitOnValue || "",
      exitMessage: step.exitMessage || "",
      skipOnValue: step.skipOnValue || "",
      skipToStepIndex: step.skipToStepIndex ?? null,
      isConditional: step.isConditional === "true",
      completionButtonText: step.completionButtonText || "",
      crmFieldKey: step.crmFieldKey || "",
    });
    
    // Load existing branching conditions
    if (step.branchingCondition) {
      try {
        const branchingConfig = JSON.parse(step.branchingCondition);
        if (branchingConfig.routes && Array.isArray(branchingConfig.routes)) {
          setBranchRoutes(branchingConfig.routes);
        }
        setDefaultNextStepId(branchingConfig.defaultNextStepId || null);
      } catch (e) {
        console.error('Failed to parse branching condition:', e);
        setBranchRoutes([]);
        setDefaultNextStepId(null);
      }
    } else {
      setBranchRoutes([]);
      setDefaultNextStepId(null);
    }
    
    setStepDialogOpen(true);
  };

  const handleSaveStep = () => {
    if (!selectedJourney) return;

    // Build branching condition JSON - ALWAYS set to string or null to ensure it's included in payload
    let branchingCondition: string | null = null;
    if (branchRoutes.length > 0 || defaultNextStepId) {
      branchingCondition = JSON.stringify({
        routes: branchRoutes,
        defaultNextStepId: defaultNextStepId || null,
      });
    }

    const stepData = {
      ...stepForm,
      multipleChoiceOptions: stepForm.multipleChoiceOptions.length > 0 
        ? JSON.stringify(stepForm.multipleChoiceOptions) 
        : null,
      branchingCondition,  // Explicitly set to string or null (never undefined) to ensure persistence
      isConditional: stepForm.isConditional ? "true" : "false",
      crmFieldKey: stepForm.crmFieldKey.trim() || null,
    };

    console.log('[Step Save] Branch routes:', branchRoutes);
    console.log('[Step Save] Default next step ID:', defaultNextStepId);
    console.log('[Step Save] Branching condition JSON:', branchingCondition);
    console.log('[Step Save] Full stepData being sent:', stepData);

    if (editingStep) {
      updateStepMutation.mutate({
        journeyId: selectedJourney.id,
        stepId: editingStep.id,
        data: stepData,
      });
    } else {
      createStepMutation.mutate({
        journeyId: selectedJourney.id,
        data: stepData,
      });
    }
  };

  const handleDeleteStep = (stepId: string) => {
    if (!selectedJourney) return;
    deleteStepMutation.mutate({
      journeyId: selectedJourney.id,
      stepId,
    });
  };

  const handleToggleActive = (journey: Journey) => {
    updateJourneyMutation.mutate({
      id: journey.id,
      data: { status: journey.status === 'active' ? 'inactive' : 'active' },
    });
  };

  if (isLoading) {
    return (
      <div>
        <TrainingNavTabs />
        <div className="flex items-center justify-center h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <TrainingNavTabs />
      <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Route className="w-7 h-7 text-blue-600" />
            Conversation Journeys
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Create guided conversation flows to systematically collect information
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setShowTemplates(true)} size="lg" className="gap-2 shadow-md hover:shadow-lg transition-all">
            <Plus className="w-5 h-5" />
            New Journey
          </Button>
        </div>
      </div>

      {/* The journey list stays narrow so the builder (questions + live preview) gets the room,
          and on wide screens it can be folded into a strip of initials. */}
      <div className={`grid grid-cols-1 gap-6 ${listCollapsed ? "lg:grid-cols-[56px_minmax(0,1fr)]" : "lg:grid-cols-[208px_minmax(0,1fr)]"}`}>
        <div className="min-w-0">
          <div className="sticky top-6">
            {listCollapsed && (
              <div className="hidden lg:flex flex-col items-center gap-2 rounded-xl bg-white dark:bg-gray-900 shadow-sm py-2" data-testid="journey-list-collapsed">
                <button
                  type="button"
                  onClick={toggleList}
                  className="p-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800"
                  title="Show journeys"
                  aria-label="Show journeys"
                  data-testid="button-expand-journey-list"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
                <div className="flex flex-col items-center gap-1.5 max-h-[calc(100vh-200px)] overflow-y-auto px-1 pb-1">
                  {journeys?.map((journey) => (
                    <button
                      key={journey.id}
                      type="button"
                      onClick={() => loadJourneyWithSteps(journey.id)}
                      onMouseEnter={() => handleJourneyHover(journey.id)}
                      title={`${journey.name}${journey.status === 'active' ? "" : " (off)"}`}
                      aria-label={journey.name}
                      className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[13px] font-semibold transition-colors ${
                        selectedJourneyId === journey.id
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-blue-50 hover:text-blue-700 dark:bg-gray-800 dark:text-gray-200"
                      }`}
                    >
                      {(journey.name || "?").trim().charAt(0).toUpperCase()}
                      <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-gray-900 ${journey.status === 'active' ? "bg-green-500" : "bg-gray-300"}`} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Card className={`shadow-sm border-0 bg-gradient-to-br from-white to-gray-50/50 dark:from-gray-900 dark:to-gray-800/50 ${listCollapsed ? "lg:hidden" : ""}`}>
              <CardHeader className="px-4 pt-4 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">Your journeys</CardTitle>
                    <CardDescription className="text-xs">
                      {journeys?.length || 0} journey{journeys?.length !== 1 ? "s" : ""}
                    </CardDescription>
                  </div>
                  <button
                    type="button"
                    onClick={toggleList}
                    className="hidden lg:inline-flex p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800"
                    title="Hide the list"
                    aria-label="Hide the list"
                    data-testid="button-collapse-journey-list"
                  >
                    <PanelLeftClose className="w-4 h-4" />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[calc(100vh-240px)] overflow-y-auto px-2 pb-3">
                {journeys?.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <Route className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    <p className="text-sm font-medium">No journeys yet</p>
                    <p className="text-xs mt-1">Create one to get started</p>
                  </div>
                ) : (
                  journeys?.map((journey) => (
                    <div
                      key={journey.id}
                      className={`group relative px-2.5 py-2 rounded-lg cursor-pointer transition-colors border-l-[3px] ${
                        selectedJourneyId === journey.id
                          ? "bg-blue-50 dark:bg-blue-950/30 border-blue-500"
                          : "hover:bg-gray-100/70 dark:hover:bg-gray-800 border-transparent"
                      }`}
                      onClick={() => loadJourneyWithSteps(journey.id)}
                      onMouseEnter={() => handleJourneyHover(journey.id)}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h3 className={`font-medium text-sm truncate ${
                              selectedJourneyId === journey.id ? "text-blue-700 dark:text-blue-300" : ""
                            }`} title={journey.name}>
                              {journey.name}
                            </h3>
                            {journey.status === 'active' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" aria-label="On" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" aria-label="Off" />
                            )}
                          </div>
                          {journey.description && (
                            <p className="text-xs text-muted-foreground truncate" title={journey.description}>
                              {journey.description}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateJourney(journey.id);
                          }}
                          disabled={duplicatingJourneyId === journey.id}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0"
                          title="Duplicate journey"
                        >
                          {duplicatingJourneyId === journey.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="min-w-0">
          {isLoadingJourney ? (
            <div className="space-y-6 animate-fade-in">
              <Card className="shadow-sm">
                <CardHeader className="space-y-4">
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-4 w-96" />
                  <div className="flex gap-4">
                    <Skeleton className="h-10 w-32" />
                    <Skeleton className="h-10 w-32" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-32 w-full" />
                  <Skeleton className="h-32 w-full" />
                </CardContent>
              </Card>
            </div>
          ) : selectedJourney ? (
            <div className="space-y-6 animate-fade-in">
              <Card className="shadow-md border-0">
                <CardHeader className="space-y-6 pb-6">
                  <div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        {editingJourneyName ? (
                          <div className="flex items-center gap-2 mb-2">
                            <Input
                              value={editedJourneyName}
                              onChange={(e) => setEditedJourneyName(e.target.value)}
                              className="text-3xl font-bold h-auto py-2 px-3"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (editedJourneyName.trim()) {
                                    updateJourneyMutation.mutate({
                                      id: selectedJourney.id,
                                      data: { name: editedJourneyName.trim() },
                                    });
                                    setEditingJourneyName(false);
                                  }
                                } else if (e.key === 'Escape') {
                                  setEditingJourneyName(false);
                                  setEditedJourneyName(selectedJourney.name);
                                }
                              }}
                            />
                            <Button
                              size="sm"
                              onClick={() => {
                                if (editedJourneyName.trim()) {
                                  updateJourneyMutation.mutate({
                                    id: selectedJourney.id,
                                    data: { name: editedJourneyName.trim() },
                                  });
                                  setEditingJourneyName(false);
                                }
                              }}
                              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingJourneyName(false);
                                setEditedJourneyName(selectedJourney.name);
                              }}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="group flex items-center gap-2 mb-2">
                            <h2 
                              className="text-3xl font-bold cursor-pointer hover:text-blue-600 transition-colors"
                              onClick={() => {
                                setEditingJourneyName(true);
                                setEditedJourneyName(selectedJourney.name);
                              }}
                              title="Click to edit name"
                            >
                              {selectedJourney.name}
                            </h2>
                            <Edit2 className="w-4 h-4 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
                          </div>
                        )}
                        {editingJourneyDescription ? (
                          <div className="flex items-start gap-2">
                            <Textarea
                              value={editedJourneyDescription}
                              onChange={(e) => setEditedJourneyDescription(e.target.value)}
                              className="text-base text-muted-foreground resize-none min-h-[60px]"
                              placeholder="Add a description..."
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.metaKey) {
                                  updateJourneyMutation.mutate({
                                    id: selectedJourney.id,
                                    data: { description: editedJourneyDescription.trim() },
                                  });
                                  setEditingJourneyDescription(false);
                                } else if (e.key === 'Escape') {
                                  setEditingJourneyDescription(false);
                                  setEditedJourneyDescription(selectedJourney.description || "");
                                }
                              }}
                            />
                            <div className="flex flex-col gap-1 pt-1">
                              <Button
                                size="sm"
                                onClick={() => {
                                  updateJourneyMutation.mutate({
                                    id: selectedJourney.id,
                                    data: { description: editedJourneyDescription.trim() },
                                  });
                                  setEditingJourneyDescription(false);
                                }}
                                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 h-8 w-8 p-0"
                              >
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingJourneyDescription(false);
                                  setEditedJourneyDescription(selectedJourney.description || "");
                                }}
                                className="h-8 w-8 p-0"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="group flex items-start gap-2">
                            <p className="text-muted-foreground text-base flex-1">
                              {selectedJourney.description || "No description"}
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0 flex-shrink-0"
                              onClick={() => {
                                setEditingJourneyDescription(true);
                                setEditedJourneyDescription(selectedJourney.description || "");
                              }}
                            >
                              <Edit2 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <Card className="bg-gradient-to-br from-blue-50/50 to-indigo-50/30 dark:from-blue-950/20 dark:to-indigo-950/10 border-blue-200/50 dark:border-blue-800/30 shadow-sm">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between p-3 bg-white/60 dark:bg-gray-800/30 rounded-lg">
                        <div>
                          <Label htmlFor="enable-journey" className="text-sm font-medium cursor-pointer">
                            Enable Journey
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Activate this journey for use
                          </p>
                        </div>
                        <Switch
                          id="enable-journey"
                          checked={selectedJourney.status === 'active'}
                          onCheckedChange={(checked) => {
                            updateJourneyMutation.mutate({
                              id: selectedJourney.id,
                              data: { 
                                status: checked ? 'active' : 'inactive',
                                ...(checked ? {} : { isDefault: 'false' })
                              },
                            });
                            toast({ title: checked ? "Journey enabled!" : "Journey disabled" });
                          }}
                          className="data-[state=checked]:bg-green-600"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-black/[0.08] shadow-sm" data-testid="journey-settings">
                    <CardContent className="space-y-5 pb-5 pt-5">
                      <div>
                        <p className="text-sm font-medium">When does it start?</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                          {([
                            ['open', 'As soon as the chat opens', 'The first question is the greeting. Use this for one journey only.'],
                            ['mentions', 'When the visitor mentions…', 'Words you choose below, like "fees" or "admission".'],
                            ['menu', 'From a menu button', 'Add it in Website chat › Settings › Chat menu & forms.'],
                          ] as const).map(([mode, title, hint]) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => {
                                setStartMode(mode);
                                updateJourneyMutation.mutate({
                                  id: selectedJourney.id,
                                  data: mode === 'open'
                                    ? { startFromScratch: 'true' }
                                    : mode === 'mentions'
                                      ? { startFromScratch: 'false' }
                                      : { startFromScratch: 'false', triggerKeywords: null as unknown as string, triggerMode: 'manual' },
                                });
                              }}
                              className={`rounded-xl border p-3 text-left transition-colors ${startMode === mode ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:bg-gray-50'}`}
                              data-testid={`start-${mode}`}
                            >
                              <span className={`block text-sm font-medium ${startMode === mode ? 'text-purple-900' : 'text-gray-800'}`}>{title}</span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium">How are the questions asked?</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {([
                            ['form', 'Exactly as written', 'Your words, with buttons for options. Answers are checked (mobile, email).'],
                            ['conversational', "In the AI's own words", 'Feels more natural, and the AI can answer side questions on the way.'],
                          ] as const).map(([type, title, hint]) => {
                            const active = (selectedJourney.journeyType === 'form' ? 'form' : 'conversational') === type;
                            return (
                              <button
                                key={type}
                                type="button"
                                onClick={() => !active && updateJourneyMutation.mutate({ id: selectedJourney.id, data: { journeyType: type } })}
                                className={`rounded-xl border p-3 text-left transition-colors ${active ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:bg-gray-50'}`}
                                data-testid={`asks-${type}`}
                              >
                                <span className={`block text-sm font-medium ${active ? 'text-purple-900' : 'text-gray-800'}`}>{title}</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium">When the journey ends</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {([
                            ['chat', 'The visitor can keep chatting', 'After the closing message, a "Chat Now" button lets them ask the AI anything.'],
                            ['end', 'End the chat here (no AI)', 'No "Chat Now" and no typing after the closing message. Only "Start a new chat".'],
                          ] as const).map(([mode, title, hint]) => {
                            const active = (selectedJourney.endMode === 'end' ? 'end' : 'chat') === mode;
                            return (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => !active && updateJourneyMutation.mutate({ id: selectedJourney.id, data: { endMode: mode } })}
                                className={`rounded-xl border p-3 text-left transition-colors ${active ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:bg-gray-50'}`}
                                data-testid={`ends-${mode}`}
                              >
                                <span className={`block text-sm font-medium ${active ? 'text-purple-900' : 'text-gray-800'}`}>{title}</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {startMode === 'mentions' && (
                    <Card className="bg-gradient-to-br from-purple-50/50 to-pink-50/30 dark:from-purple-950/20 dark:to-pink-950/10 border-purple-200/50 dark:border-purple-800/30 shadow-sm">
                      <CardHeader className="pb-4">
                        <CardTitle className="text-base">Trigger Keywords</CardTitle>
                        <CardDescription className="text-sm">
                          Auto-start this journey when users mention these keywords
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {parsedTriggerKeywords.map((keyword, index) => (
                            <div
                              key={index}
                              className="group flex items-center gap-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-3 py-1.5 rounded-full text-sm font-medium transition-all hover:bg-purple-200 dark:hover:bg-purple-900/50"
                            >
                              <span>{keyword}</span>
                              <button
                                onClick={() => {
                                  const newKeywords = parsedTriggerKeywords.filter((_, i) => i !== index);
                                  updateJourneyMutation.mutate({
                                    id: selectedJourney.id,
                                    data: { triggerKeywords: JSON.stringify(newKeywords) },
                                  });
                                  toast({ title: `Removed trigger: "${keyword}"` });
                                }}
                                className="hover:bg-red-500/20 rounded-full p-0.5 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          {parsedTriggerKeywords.length === 0 && (
                            <p className="text-sm text-muted-foreground italic">No triggers set</p>
                          )}
                        </div>
                        <Input
                          type="text"
                          placeholder="Type keyword and press Enter..."
                          className="bg-white/60 dark:bg-gray-800/30"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                              const newKeyword = e.currentTarget.value.trim();
                              if (!parsedTriggerKeywords.includes(newKeyword)) {
                                const newKeywords = [...parsedTriggerKeywords, newKeyword];
                                updateJourneyMutation.mutate({
                                  id: selectedJourney.id,
                                  data: { triggerKeywords: JSON.stringify(newKeywords) },
                                });
                                e.currentTarget.value = '';
                                toast({ title: `Added trigger: "${newKeyword}"` });
                              } else {
                                toast({ title: "Keyword already exists", variant: "destructive" });
                              }
                            }
                          }}
                        />
                      </CardContent>
                    </Card>
                  )}

                  {selectedJourney.journeyType !== 'form' && (
                    <Card className="bg-gradient-to-br from-purple-50/50 to-blue-50/30 dark:from-purple-950/20 dark:to-blue-950/10 border-purple-200/50 dark:border-purple-800/30 shadow-sm">
                      <CardHeader className="pb-4">
                        <CardTitle className="text-base flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                          Journey-Specific Training
                        </CardTitle>
                      <CardDescription className="text-sm">
                        Optional conversational guidelines that work alongside your global Train {brandShort()} instructions when this journey is active
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                      {/* Existing Instructions List */}
                      {journeyInstructions.length > 0 && (
                        <div className="space-y-2">
                          {journeyInstructions.map((instruction, index) => (
                            <div key={instruction.id} className="group relative">
                              {editingInstructionId === instruction.id ? (
                                <div className="space-y-2">
                                  <Textarea
                                    value={editInstructionText}
                                    onChange={(e) => setEditInstructionText(e.target.value)}
                                    className="min-h-[80px] bg-white/60 dark:bg-gray-800/30 resize-none text-sm"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && e.metaKey) {
                                        handleUpdateJourneyInstruction(instruction.id, editInstructionText);
                                      } else if (e.key === 'Escape') {
                                        setEditingInstructionId(null);
                                      }
                                    }}
                                  />
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setEditingInstructionId(null)}
                                    >
                                      <X className="w-3 h-3 mr-1" />
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => handleUpdateJourneyInstruction(instruction.id, editInstructionText)}
                                      className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                                    >
                                      <Check className="w-3 h-3 mr-1" />
                                      Save
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-start gap-2 p-3 rounded-lg bg-white/60 dark:bg-gray-800/30 border border-purple-200/30 dark:border-purple-800/20 hover:border-purple-300/50 dark:hover:border-purple-700/40 transition-colors">
                                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 text-white flex items-center justify-center text-xs font-medium mt-0.5">
                                    {index + 1}
                                  </div>
                                  <p className="flex-1 text-sm leading-relaxed pt-0.5">{instruction.text}</p>
                                  <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0"
                                      onClick={() => handleRefineJourneyInstruction(instruction)}
                                    >
                                      <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0"
                                      onClick={() => {
                                        setEditingInstructionId(instruction.id);
                                        setEditInstructionText(instruction.text);
                                      }}
                                    >
                                      <Edit2 className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0"
                                      onClick={() => {
                                        setInstructionToDelete(instruction.id);
                                        setDeleteInstructionDialogOpen(true);
                                      }}
                                    >
                                      <Trash2 className="w-3.5 h-3.5 text-red-500 hover:text-red-600" />
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add New Instruction Input */}
                      <div className="space-y-2">
                        <Textarea
                          value={newJourneyInstruction}
                          onChange={(e) => setNewJourneyInstruction(e.target.value)}
                          placeholder="Add a conversational guideline for this journey...&#10;&#10;Example: Use enthusiastic acknowledgments like 'Awesome!' and 'Perfect!'"
                          className="min-h-[80px] bg-white/60 dark:bg-gray-800/30 resize-none text-sm"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.metaKey) {
                              handleAddJourneyInstruction();
                            }
                          }}
                        />
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted-foreground">
                            {journeyInstructions.length === 0 ? "Add your first instruction" : `${journeyInstructions.length} instruction${journeyInstructions.length === 1 ? '' : 's'}`}
                          </p>
                          <Button
                            size="sm"
                            onClick={handleAddJourneyInstruction}
                            disabled={!newJourneyInstruction.trim()}
                            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Add Instruction
                          </Button>
                        </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h3 className="text-xl font-semibold">Questions</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Asked one after another, top to bottom. Click a question to change it, and try the journey on the right.
                    </p>
                  </div>
                  <JourneyBuilder
                    journeyId={selectedJourney.id}
                    steps={selectedJourney.steps ?? []}
                    aiWords={selectedJourney.journeyType !== 'form'}
                  />
                </CardContent>
              </Card>

              <Card className="border-red-200 dark:border-red-800/50 bg-red-50/30 dark:bg-red-950/10 shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base text-red-700 dark:text-red-400">Danger Zone</CardTitle>
                  <CardDescription className="text-sm">
                    Irreversible actions that will permanently delete data
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setJourneyToDelete(selectedJourney.id);
                      setDeleteDialogOpen(true);
                    }}
                    className="gap-2 shadow-sm hover:shadow-md transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Journey
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="shadow-md border-0">
              <CardContent className="flex flex-col items-center justify-center py-32">
                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/20 p-8 rounded-full mb-6">
                  <Route className="w-20 h-20 text-blue-400 dark:text-blue-500" />
                </div>
                <h3 className="text-2xl font-semibold text-gray-700 dark:text-gray-300 mb-3">No Journey Selected</h3>
                <p className="text-base text-muted-foreground text-center max-w-md mb-6">
                  Select a journey from the list or create a new one to start building conversation flows
                </p>
                <Button onClick={() => setShowTemplates(true)} size="lg" className="gap-2 shadow-md">
                  <Plus className="w-5 h-5" />
                  Create Your First Journey
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <NewJourneyDialog
        open={showTemplates}
        onOpenChange={setShowTemplates}
        onCreated={(id) => {
          queryClient.invalidateQueries({ queryKey: ["/api/journeys"] });
          loadJourneyWithSteps(id);
        }}
        onDescribe={() => setShowImportDialog(true)}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Journey?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this journey and all its steps. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (journeyToDelete) {
                  deleteJourneyMutation.mutate(journeyToDelete);
                  setDeleteDialogOpen(false);
                }
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-2xl">
              <FileText className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              Import from Conversation Script
            </DialogTitle>
            <DialogDescription className="text-base">
              Paste a sample conversation and let AI automatically extract the journey structure, questions, and conversational style.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="script" className="text-base font-medium">Conversation Script</Label>
              <Textarea
                id="script"
                placeholder="Example:&#10;&#10;Agent: Hi! What's your current education level?&#10;User: I'm in high school.&#10;Agent: Great! What subjects interest you most?&#10;User: I love science and math.&#10;Agent: Awesome! What are your career goals?&#10;..."
                value={scriptInput}
                onChange={(e) => setScriptInput(e.target.value)}
                rows={12}
                className="font-mono text-sm resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Paste a sample conversation between your chatbot and a customer. Include multiple questions and responses to help AI understand the flow.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowImportDialog(false);
              setScriptInput("");
            }}>
              Cancel
            </Button>
            <Button 
              onClick={handleParseScript} 
              disabled={!scriptInput.trim() || isParsingScript}
              className="gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              {isParsingScript ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Analyze with AI
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showScriptPreview} onOpenChange={setShowScriptPreview}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-2xl">
              <Sparkles className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              AI Analysis Results
            </DialogTitle>
            <DialogDescription className="text-base">
              Review the extracted journey structure and make any adjustments before creating.
            </DialogDescription>
          </DialogHeader>
          {parsedScriptData && (
            <div className="space-y-6 py-4">
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Journey Name</Label>
                  <p className="text-lg font-semibold">{parsedScriptData.journeyName}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Description</Label>
                  <p className="text-base">{parsedScriptData.description}</p>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-base font-semibold">Questions ({parsedScriptData.steps?.length || 0})</Label>
                <div className="space-y-2">
                  {parsedScriptData.steps?.map((step: any, index: number) => (
                    <div key={index} className="p-4 rounded-lg border bg-card">
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-semibold text-sm">
                          {index + 1}
                        </div>
                        <div className="flex-1 space-y-2">
                          <p className="font-medium">{step.questionText}</p>
                          <div className="flex flex-wrap gap-2">
                            {step.isRequired && (
                              <span className="px-2 py-1 text-xs rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                                Required
                              </span>
                            )}
                            {step.toolTrigger && (
                              <span className="px-2 py-1 text-xs rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                                Tool: {step.toolTrigger}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {parsedScriptData.triggerKeywords?.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-base font-semibold">Auto-trigger Keywords</Label>
                  <div className="flex flex-wrap gap-2">
                    {parsedScriptData.triggerKeywords.map((keyword: string, index: number) => (
                      <span key={index} className="px-3 py-1 text-sm rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {parsedScriptData.conversationalGuidelines && (
                <div className="space-y-2">
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    Conversational Guidelines
                  </Label>
                  <div className="p-4 rounded-lg border bg-purple-50/50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
                    <p className="text-sm whitespace-pre-wrap">{parsedScriptData.conversationalGuidelines}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    These journey-specific instructions will work alongside your global Train {brandShort()} instructions when this journey is active.
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowScriptPreview(false);
              setParsedScriptData(null);
              setScriptInput("");
            }}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreateFromScript}
              className="gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              <Check className="w-4 h-4" />
              Create Journey
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Instruction Confirmation Dialog */}
      <AlertDialog open={deleteInstructionDialogOpen} onOpenChange={setDeleteInstructionDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Instruction?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this instruction from the journey training. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteJourneyInstruction}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Refine Instruction Dialog */}
      <Dialog open={refineInstructionDialogOpen} onOpenChange={setRefineInstructionDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              AI-Refined Instruction
            </DialogTitle>
            <DialogDescription>
              AI has refined your instruction for clarity and effectiveness.
            </DialogDescription>
          </DialogHeader>
          {isRefiningInstruction ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600 dark:text-purple-400" />
              <p className="text-sm text-muted-foreground">Refining instruction with AI...</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">Original</Label>
                <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-800 border">
                  <p className="text-sm">{originalInstructionText}</p>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium mb-2 block">Refined</Label>
                <Textarea
                  value={refinedInstructionText}
                  onChange={(e) => setRefinedInstructionText(e.target.value)}
                  className="min-h-[100px] resize-none"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRefineInstructionDialogOpen(false)}
              disabled={isRefiningInstruction}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAcceptRefinedInstruction}
              disabled={isRefiningInstruction}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            >
              <Check className="w-4 h-4 mr-2" />
              Accept Refined
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}
