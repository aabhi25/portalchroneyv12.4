import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <Route className="w-7 h-7 text-blue-600" />
            Conversation Journeys
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Create guided conversation flows to systematically collect information
          </p>
        </div>
        <div className="flex gap-3">
          <Button 
            onClick={() => setShowImportDialog(true)} 
            size="lg" 
            variant="outline"
            className="gap-2 shadow-sm hover:shadow-md transition-all border-purple-200 hover:border-purple-400 hover:bg-purple-50 dark:border-purple-800 dark:hover:border-purple-600 dark:hover:bg-purple-950/30"
          >
            <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            Import from Script
          </Button>
          <Button onClick={() => setShowTemplates(true)} size="lg" className="gap-2 shadow-md hover:shadow-lg transition-all">
            <Plus className="w-5 h-5" />
            New Journey
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <div className="lg:col-span-2">
          <div className="sticky top-6">
            <Card className="shadow-sm border-0 bg-gradient-to-br from-white to-gray-50/50 dark:from-gray-900 dark:to-gray-800/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">Your Journeys</CardTitle>
                <CardDescription className="text-base">
                  {journeys?.length || 0} journey{journeys?.length !== 1 ? "s" : ""} created
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-2">
                {journeys?.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Route className="w-16 h-16 mx-auto mb-3 opacity-20" />
                    <p className="text-base font-medium">No journeys yet</p>
                    <p className="text-sm mt-1">Create one to get started</p>
                  </div>
                ) : (
                  journeys?.map((journey) => (
                    <div
                      key={journey.id}
                      className={`group relative p-4 rounded-xl cursor-pointer transition-all duration-300 ${
                        selectedJourneyId === journey.id
                          ? "bg-blue-50 dark:bg-blue-950/30 shadow-md border-l-4 border-blue-500"
                          : "bg-white dark:bg-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800 hover:shadow-md border-l-4 border-transparent"
                      }`}
                      onClick={() => loadJourneyWithSteps(journey.id)}
                      onMouseEnter={() => handleJourneyHover(journey.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className={`font-semibold text-base truncate ${
                              selectedJourneyId === journey.id ? "text-blue-700 dark:text-blue-300" : ""
                            }`}>
                              {journey.name}
                            </h3>
                            {journey.status === 'active' ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-gray-400 flex-shrink-0" />
                            )}
                          </div>
                          {journey.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">
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
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex-shrink-0"
                          title="Duplicate journey"
                        >
                          {duplicatingJourneyId === journey.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Copy className="w-4 h-4" />
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

        <div className="lg:col-span-3">
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

                  <Card className="bg-gradient-to-br from-orange-50/50 to-amber-50/30 dark:from-orange-950/20 dark:to-amber-950/10 border-orange-200/50 dark:border-orange-800/30 shadow-sm">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between p-3 bg-white/60 dark:bg-gray-800/30 rounded-lg">
                        <div>
                          <Label htmlFor="start-from-scratch" className="text-sm font-medium cursor-pointer">
                            Start from Scratch
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Journey starts immediately - first step becomes the greeting message
                          </p>
                        </div>
                        <Switch
                          id="start-from-scratch"
                          checked={selectedJourney.startFromScratch === 'true'}
                          onCheckedChange={(checked) => {
                            updateJourneyMutation.mutate({
                              id: selectedJourney.id,
                              data: { startFromScratch: checked ? 'true' : 'false' },
                            });
                            toast({ title: checked ? "Journey will start from scratch" : "Journey requires trigger keywords" });
                          }}
                          className="data-[state=checked]:bg-orange-600"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {selectedJourney.startFromScratch !== 'true' && (
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
                        Optional conversational guidelines that work alongside your global Train Chroney instructions when this journey is active
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
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-semibold">Conversation Steps</h3>
                    <div className="flex items-center gap-2">
                      {sortedSteps.length > 0 && (
                        <Button
                          variant="outline"
                          onClick={() => setJourneyMapOpen(true)}
                          className="gap-2 shadow-sm hover:shadow-md transition-all"
                        >
                          <Route className="w-4 h-4" />
                          View Journey Map
                        </Button>
                      )}
                      <Button
                        onClick={() => {
                          setEditingStep(null);
                          resetStepForm();
                          setStepDialogOpen(true);
                        }}
                        className="gap-2 shadow-sm hover:shadow-md transition-all"
                      >
                        <Plus className="w-4 h-4" />
                        Add Step
                      </Button>
                    </div>
                  </div>

                  {!selectedJourney.steps || selectedJourney.steps.length === 0 ? (
                    <div className="text-center py-16 border-2 border-dashed rounded-xl bg-gradient-to-br from-gray-50/50 to-white dark:from-gray-800/30 dark:to-gray-900/20">
                      <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-20" />
                      <p className="text-base font-medium text-muted-foreground mb-1">No steps yet</p>
                      <p className="text-sm text-muted-foreground">Add questions to guide the conversation</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {sortedSteps.map((step, index) => (
                        <div
                          key={step.id}
                          draggable
                          onDragStart={() => handleDragStart(step.id)}
                          onDragOver={(e) => handleDragOver(e, step.id)}
                          onDragEnd={handleDragEnd}
                          className="group flex items-start gap-4 p-5 border-0 rounded-xl bg-gradient-to-br from-white to-gray-50/50 dark:from-gray-800/50 dark:to-gray-900/30 hover:shadow-lg transition-all duration-300 cursor-move hover:scale-[1.02] shadow-sm"
                        >
                          <GripVertical className="w-5 h-5 text-gray-400 mt-1 flex-shrink-0 group-hover:text-blue-500 transition-colors" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-xs font-semibold text-blue-600 bg-blue-100 dark:bg-blue-900/40 px-2.5 py-1 rounded-full">
                                Step {index + 1}
                              </span>
                              {step.isRequired === 'true' && (
                                <span className="text-xs font-semibold text-red-600 bg-red-100 dark:bg-red-900/40 px-2.5 py-1 rounded-full">
                                  Required
                                </span>
                              )}
                              {step.toolTrigger && step.toolTrigger !== 'none' && (
                                <span className="text-xs font-semibold text-purple-600 bg-purple-100 dark:bg-purple-900/40 px-2.5 py-1 rounded-full">
                                  {step.toolTrigger}
                                </span>
                              )}
                              {step.branchingCondition && (() => {
                                try {
                                  const branchConfig = JSON.parse(step.branchingCondition);
                                  const routeCount = branchConfig.routes?.length || 0;
                                  if (routeCount > 0) {
                                    return (
                                      <span className="flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-100 dark:bg-orange-900/40 px-2.5 py-1 rounded-full">
                                        <GitBranch className="w-3 h-3" />
                                        {routeCount} {routeCount === 1 ? 'route' : 'routes'}
                                      </span>
                                    );
                                  }
                                } catch (e) {
                                  return null;
                                }
                                return null;
                              })()}
                            </div>
                            <p className="text-base font-medium leading-relaxed">{step.questionText}</p>
                            <p className="text-sm text-muted-foreground mt-2">
                              Type: <span className="font-medium">{step.questionType}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEditStep(step)}
                              className="hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteStep(step.id)}
                              className="hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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

      <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose Journey Type</DialogTitle>
            <DialogDescription>
              Choose a journey type to get started
            </DialogDescription>
          </DialogHeader>
          
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {JOURNEY_TYPES.map((type) => {
              const Icon = type.icon;
              const isConversational = type.journeyType === "conversational";
              return (
                <Card
                  key={type.id}
                  className={`cursor-pointer transition-colors ${isConversational ? 'hover:border-blue-500' : 'hover:border-purple-500'}`}
                  onClick={() => handleCreateFromTemplate(type)}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Icon className={`w-5 h-5 ${isConversational ? 'text-blue-600' : 'text-purple-600'}`} />
                      {type.name}
                    </CardTitle>
                    <CardDescription>{type.description}</CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={stepDialogOpen} onOpenChange={setStepDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle>{editingStep ? "Edit Step" : "Add Step"}</DialogTitle>
            <DialogDescription>
              Configure the question and response handling
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-4">
            {/* Tool Trigger - shown first */}
            <div>
              <Label htmlFor="toolTrigger">Step Type</Label>
              <Select
                value={stepForm.toolTrigger}
                onValueChange={(value) => setStepForm({ ...stepForm, toolTrigger: value })}
              >
                <SelectTrigger id="toolTrigger" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOOL_TRIGGERS
                    .filter((trigger) => {
                      // For form journeys, only show none, book_appointment, and journey_complete
                      if (selectedJourney?.journeyType === 'form') {
                        return ['none', 'book_appointment', 'journey_complete'].includes(trigger.value);
                      }
                      // For conversational journeys, hide journey_complete
                      return trigger.value !== 'journey_complete';
                    })
                    .map((trigger) => (
                    <SelectItem key={trigger.value} value={trigger.value}>
                      {trigger.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {stepForm.toolTrigger === 'none' 
                  ? 'Ask a question and collect user response'
                  : stepForm.toolTrigger === 'journey_complete'
                  ? 'Show a completion message and optionally let users continue chatting'
                  : 'This step will trigger an action (no question needed)'}
              </p>
            </div>

            {/* Journey Complete configuration */}
            {stepForm.toolTrigger === 'journey_complete' && (
              <div className="space-y-4 p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <Label className="text-sm font-semibold">Journey Complete Settings</Label>
                </div>
                
                <div>
                  <Label htmlFor="completionMessage">Completion Message *</Label>
                  <Textarea
                    id="completionMessage"
                    value={stepForm.questionText}
                    onChange={(e) => setStepForm({ ...stepForm, questionText: e.target.value })}
                    placeholder="Thank you for completing the form! We'll be in touch soon."
                    className="mt-1"
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    This message is shown when the journey ends
                  </p>
                </div>

                <div>
                  <Label htmlFor="completionButtonText">Continue Button (Optional)</Label>
                  <Input
                    id="completionButtonText"
                    value={stepForm.completionButtonText}
                    onChange={(e) => setStepForm({ ...stepForm, completionButtonText: e.target.value })}
                    placeholder="Continue Exploring"
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    If set, shows a button that opens normal AI chat
                  </p>
                </div>
              </div>
            )}

            {/* Question configuration - only shown when no tool is selected */}
            {stepForm.toolTrigger === 'none' && (
              <>
                <div>
                  <Label htmlFor="questionText">Question Text *</Label>
                  <Textarea
                    id="questionText"
                    value={stepForm.questionText}
                    onChange={(e) => setStepForm({ ...stepForm, questionText: e.target.value })}
                    placeholder="What would you like to ask the user?"
                    className="mt-1"
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor="questionType">Field Type</Label>
                  <Select
                    value={stepForm.questionType}
                    onValueChange={(value) => setStepForm({ ...stepForm, questionType: value, multipleChoiceOptions: (value !== 'dropdown' && value !== 'radio') ? [] : stepForm.multipleChoiceOptions })}
                  >
                    <SelectTrigger id="questionType" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Answer Options - shown when Dropdown or Radio is selected */}
                {(stepForm.questionType === 'dropdown' || stepForm.questionType === 'radio') && (
                  <div className="border rounded-lg p-4 bg-purple-50/50 dark:bg-purple-950/20">
                    <Label className="mb-2 block">Answer Options</Label>
                    <p className="text-xs text-muted-foreground mb-3">
                      Add the choices users can select from (e.g., Yes, No, Maybe)
                    </p>
                    <div className="space-y-2">
                      {stepForm.multipleChoiceOptions.map((option, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Input
                            value={option}
                            onChange={(e) => {
                              const newOptions = [...stepForm.multipleChoiceOptions];
                              newOptions[index] = e.target.value;
                              setStepForm({ ...stepForm, multipleChoiceOptions: newOptions });
                            }}
                            placeholder={`Option ${index + 1}`}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const newOptions = stepForm.multipleChoiceOptions.filter((_, i) => i !== index);
                              setStepForm({ ...stepForm, multipleChoiceOptions: newOptions });
                            }}
                            className="h-9 w-9 p-0 hover:bg-red-100 dark:hover:bg-red-900/30"
                          >
                            <X className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setStepForm({ ...stepForm, multipleChoiceOptions: [...stepForm.multipleChoiceOptions, ''] })}
                        className="w-full mt-2"
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Add Option
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Switch
                    id="isRequired"
                    checked={stepForm.isRequired === 'true'}
                    onCheckedChange={(checked) => setStepForm({ ...stepForm, isRequired: checked ? 'true' : 'false' })}
                  />
                  <Label htmlFor="isRequired" className="cursor-pointer">
                    This field is required
                  </Label>
                </div>

                {/* CRM Field Key - maps this step's answer into LeadSquared */}
                <div className="space-y-2">
                  <Label htmlFor="crmFieldKey">CRM Field Key (Optional)</Label>
                  <Input
                    id="crmFieldKey"
                    data-testid="input-crm-field-key"
                    placeholder="e.g., Course, Budget, mx_Interest"
                    value={stepForm.crmFieldKey}
                    onChange={(e) => setStepForm({ ...stepForm, crmFieldKey: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Tag this answer with a key, then map it to a LeadSquared field in CRM settings using <span className="font-mono">journey.{stepForm.crmFieldKey.trim() || "yourKey"}</span>.
                  </p>
                </div>

                {/* Exit on Answer - only for dropdown/radio in form journeys */}
                {selectedJourney?.journeyType === 'form' && (stepForm.questionType === 'dropdown' || stepForm.questionType === 'radio') && stepForm.multipleChoiceOptions.length > 0 && (
                  <div className="border-t pt-4 mt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <X className="w-4 h-4 text-orange-500" />
                      <Label className="text-sm font-semibold">Exit on Answer (Optional)</Label>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      End the journey when a specific answer is selected
                    </p>
                    
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="exitOnValue" className="text-sm">Exit when answer is</Label>
                        <Select
                          value={stepForm.exitOnValue || "none"}
                          onValueChange={(value) => setStepForm({ ...stepForm, exitOnValue: value === "none" ? "" : value })}
                        >
                          <SelectTrigger id="exitOnValue" className="mt-1">
                            <SelectValue placeholder="Select an option..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No exit condition</SelectItem>
                            {stepForm.multipleChoiceOptions.filter(opt => opt.trim()).map((option, index) => (
                              <SelectItem key={index} value={option}>{option}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      
                      {stepForm.exitOnValue && (
                        <div>
                          <Label htmlFor="exitMessage" className="text-sm">Exit message</Label>
                          <Textarea
                            id="exitMessage"
                            value={stepForm.exitMessage}
                            onChange={(e) => setStepForm({ ...stepForm, exitMessage: e.target.value })}
                            placeholder="Thank you for your time! We'll be in touch if anything changes."
                            className="mt-1"
                            rows={2}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Skip to Step - only for dropdown/radio in form journeys */}
                {selectedJourney?.journeyType === 'form' && (stepForm.questionType === 'dropdown' || stepForm.questionType === 'radio') && stepForm.multipleChoiceOptions.length > 0 && (
                  <div className="border-t pt-4 mt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <SkipForward className="w-4 h-4 text-blue-500" />
                      <Label className="text-sm font-semibold">Skip to Step (Optional)</Label>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Jump to a specific step when a certain answer is selected
                    </p>
                    
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="skipOnValue" className="text-sm">Skip when answer is</Label>
                        <Select
                          value={stepForm.skipOnValue || "none"}
                          onValueChange={(value) => setStepForm({ ...stepForm, skipOnValue: value === "none" ? "" : value, skipToStepIndex: value === "none" ? null : stepForm.skipToStepIndex })}
                        >
                          <SelectTrigger id="skipOnValue" className="mt-1">
                            <SelectValue placeholder="Select an option..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No skip condition</SelectItem>
                            {stepForm.multipleChoiceOptions.filter(opt => opt.trim()).map((option, index) => (
                              <SelectItem key={index} value={option}>{option}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      
                      {stepForm.skipOnValue && (
                        <div>
                          <Label htmlFor="skipToStepIndex" className="text-sm">Skip to step</Label>
                          <Select
                            value={stepForm.skipToStepIndex !== null ? String(stepForm.skipToStepIndex) : "none"}
                            onValueChange={(value) => setStepForm({ ...stepForm, skipToStepIndex: value === "none" ? null : Number(value) })}
                          >
                            <SelectTrigger id="skipToStepIndex" className="mt-1">
                              <SelectValue placeholder="Select a step..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Select a step</SelectItem>
                              {selectedJourney?.steps?.filter((s) => {
                                const currentStepOrder = editingStep ? Number(editingStep.stepOrder) : (selectedJourney.steps?.length || 0);
                                return Number(s.stepOrder) > currentStepOrder;
                              }).map((s) => {
                                const label = s.questionText?.trim() || (s.toolTrigger && s.toolTrigger !== 'none' ? `[${s.toolTrigger}]` : '[No label]');
                                return (
                                  <SelectItem key={s.id} value={String(s.stepOrder)}>
                                    Step {Number(s.stepOrder) + 1}: {label.substring(0, 40)}{label.length > 40 ? '...' : ''}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground mt-1">
                            All steps between this one and the target will be skipped
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Conditional Step Checkbox */}
                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="isConditional"
                      checked={stepForm.isConditional}
                      onChange={(e) => setStepForm({ ...stepForm, isConditional: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <Label htmlFor="isConditional" className="text-sm font-medium cursor-pointer">
                      Conditional step (only shown when skipped to)
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-6">
                    When enabled, this step will only appear if explicitly jumped to via a "Skip to Step" condition. It will be skipped during normal journey progression.
                  </p>
                </div>
              </>
            )}
            
            {/* Conditional Branching Section - hidden for form journeys */}
            {selectedJourney?.journeyType !== 'form' && (
            <div className="border-t pt-4 mt-6">
              <div className="flex items-center gap-2 mb-4">
                <GitBranch className="w-5 h-5 text-purple-600" />
                <Label className="text-base font-semibold">Conditional Branching (Optional)</Label>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Route users to different steps based on their response
              </p>
              
              {/* Existing Branch Routes */}
              {branchRoutes.length > 0 && (
                <div className="space-y-2 mb-4">
                  {branchRoutes.map((route, index) => (
                    <div key={index} className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200 dark:border-purple-800">
                      <ArrowRight className="w-4 h-4 text-purple-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {route.label || `If response ${route.matchType} "${route.matchValue}"`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Go to step: {sortedSteps.find(s => s.id === route.targetStepId)?.questionText.substring(0, 40) || 'Unknown'}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setBranchRoutes(branchRoutes.filter((_, i) => i !== index))}
                        className="hover:bg-red-100 dark:hover:bg-red-900/40 flex-shrink-0"
                      >
                        <X className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Add New Route Form */}
              <Card className="bg-gray-50/50 dark:bg-gray-800/30">
                <CardContent className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="matchType" className="text-xs">Match Type</Label>
                      <Select
                        value={newRoute.matchType}
                        onValueChange={(value) => setNewRoute({ ...newRoute, matchType: value as any })}
                      >
                        <SelectTrigger id="matchType" className="mt-1 h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="contains">Contains</SelectItem>
                          <SelectItem value="exact">Exact Match</SelectItem>
                          <SelectItem value="regex">Regex</SelectItem>
                          <SelectItem value="any">Any (Default)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="matchValue" className="text-xs">Match Value</Label>
                      <Input
                        id="matchValue"
                        value={newRoute.matchValue}
                        onChange={(e) => setNewRoute({ ...newRoute, matchValue: e.target.value })}
                        placeholder="e.g., MBA, yes, engineering"
                        className="mt-1 h-9"
                        disabled={newRoute.matchType === 'any'}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <Label htmlFor="targetStep" className="text-xs">Go to Step</Label>
                    <Select
                      value={newRoute.targetStepId}
                      onValueChange={(value) => setNewRoute({ ...newRoute, targetStepId: value })}
                    >
                      <SelectTrigger id="targetStep" className="mt-1 h-9">
                        <SelectValue placeholder="Select target step" />
                      </SelectTrigger>
                      <SelectContent>
                        {sortedSteps
                          .filter(s => {
                            if (!editingStep) return true;
                            // Only show steps that come AFTER the current step (prevent loops)
                            return s.stepOrder > editingStep.stepOrder;
                          })
                          .map((step, index) => {
                            // Find actual position in full sorted list for correct numbering
                            const actualPosition = sortedSteps.findIndex(s => s.id === step.id) + 1;
                            return (
                              <SelectItem key={step.id} value={step.id}>
                                Step {actualPosition}: {step.questionText.substring(0, 50)}
                              </SelectItem>
                            );
                          })}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="routeLabel" className="text-xs">Label (Optional)</Label>
                    <Input
                      id="routeLabel"
                      value={newRoute.label}
                      onChange={(e) => setNewRoute({ ...newRoute, label: e.target.value })}
                      placeholder="e.g., If user is interested in MBA"
                      className="mt-1 h-9"
                    />
                  </div>
                  
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      if (!newRoute.targetStepId) {
                        toast({ title: "Please select a target step", variant: "destructive" });
                        return;
                      }
                      if (newRoute.matchType !== 'any' && !newRoute.matchValue) {
                        toast({ title: "Please enter a match value", variant: "destructive" });
                        return;
                      }
                      
                      setBranchRoutes([...branchRoutes, { ...newRoute }]);
                      setNewRoute({
                        matchType: 'contains',
                        matchValue: '',
                        targetStepId: '',
                        label: '',
                      });
                      toast({ title: "Branch route added" });
                    }}
                    className="w-full"
                    variant="outline"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Branch Route
                  </Button>
                </CardContent>
              </Card>
              
              {/* Default Fallback Step */}
              {branchRoutes.length > 0 && (
                <div className="mt-4 p-4 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg border border-blue-200/50 dark:border-blue-800/30">
                  <Label htmlFor="defaultNextStep" className="text-sm font-medium">Default Fallback Step (Optional)</Label>
                  <p className="text-xs text-muted-foreground mb-2 mt-1">
                    If no conditions match, jump to this step instead of the next sequential one
                  </p>
                  <Select
                    value={defaultNextStepId || undefined}
                    onValueChange={(value) => setDefaultNextStepId(value || null)}
                  >
                    <SelectTrigger id="defaultNextStep" className="mt-1 h-9">
                      <SelectValue placeholder="Next sequential step (default)" />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedSteps
                        .filter(s => {
                          if (!editingStep) return true;
                          return s.stepOrder > editingStep.stepOrder;
                        })
                        .map((step) => {
                          // Find actual position in full sorted list for correct numbering
                          const actualPosition = sortedSteps.findIndex(s => s.id === step.id) + 1;
                          return (
                            <SelectItem key={step.id} value={step.id}>
                              Step {actualPosition}: {step.questionText.substring(0, 50)}
                            </SelectItem>
                          );
                        })}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            )}
          </div>
          </div>
          <DialogFooter className="px-6 py-4 border-t bg-gray-50/50 dark:bg-gray-900/50">
            <Button variant="outline" onClick={() => setStepDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveStep} disabled={(stepForm.toolTrigger === 'none' || stepForm.toolTrigger === 'journey_complete') && !stepForm.questionText}>
              <Save className="w-4 h-4 mr-2" />
              {editingStep ? "Update" : "Add"} Step
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Journey Map Dialog - True Flowchart View */}
      <Dialog open={journeyMapOpen} onOpenChange={setJourneyMapOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Route className="w-5 h-5 text-blue-600" />
              Journey Flow: {selectedJourney?.name}
            </DialogTitle>
            <DialogDescription>
              Visual process flow showing all paths and decision branches
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto px-6 py-6 flex-1 min-h-0">
            {sortedSteps.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm text-muted-foreground">No steps in this journey yet</p>
              </div>
            ) : (
              (() => {
                // Build flow analysis data - include both skipToStepIndex and branchingCondition
                type BranchTarget = {
                  label: string;
                  targetStepNum: number;
                  type: 'skip' | 'branch';
                };
                
                type FlowNode = {
                  step: typeof sortedSteps[0];
                  index: number;
                  stepNumber: number;
                  branches: BranchTarget[];
                  normalPathLabel: string;
                  isConditional: boolean;
                  isEndStep: boolean;
                  hasBranching: boolean;
                };

                const flowNodes: FlowNode[] = sortedSteps.map((step, idx) => {
                  const branches: BranchTarget[] = [];
                  let normalPathLabel = '';
                  
                  // 1. Check skipToStepIndex in multipleChoiceOptions
                  try {
                    if (step.multipleChoiceOptions) {
                      const opts = typeof step.multipleChoiceOptions === 'string' 
                        ? JSON.parse(step.multipleChoiceOptions) 
                        : step.multipleChoiceOptions;
                      if (Array.isArray(opts)) {
                        opts.forEach((opt: string | { label?: string; value?: string; skipToStepIndex?: number }) => {
                          if (typeof opt === 'object' && opt.skipToStepIndex !== undefined) {
                            branches.push({
                              label: opt.label || opt.value || 'Skip',
                              targetStepNum: opt.skipToStepIndex + 1,
                              type: 'skip'
                            });
                          } else {
                            const lbl = typeof opt === 'string' ? opt : (opt.label || opt.value || '');
                            if (!normalPathLabel) normalPathLabel = lbl;
                          }
                        });
                      }
                    }
                  } catch (e) {}
                  
                  // 2. Check branchingCondition routes
                  try {
                    if (step.branchingCondition) {
                      const branchConfig = JSON.parse(step.branchingCondition) as { routes?: BranchRoute[], defaultNextStepId?: string | null };
                      if (branchConfig.routes && Array.isArray(branchConfig.routes)) {
                        branchConfig.routes.forEach((route: BranchRoute) => {
                          const targetStep = sortedSteps.find(s => s.id === route.targetStepId);
                          if (targetStep) {
                            const targetIdx = sortedSteps.findIndex(s => s.id === route.targetStepId);
                            branches.push({
                              label: route.label || route.matchValue || 'Branch',
                              targetStepNum: targetIdx + 1,
                              type: 'branch'
                            });
                          }
                        });
                      }
                    }
                  } catch (e) {}
                  
                  // Fallback label for normal path
                  if (!normalPathLabel) normalPathLabel = 'Continue';

                  // Normalize isConditional to handle both string and boolean values
                  const isConditionalNormalized = step.isConditional === 'true' || 
                    (step.isConditional as unknown) === true;
                  
                  return {
                    step,
                    index: idx,
                    stepNumber: idx + 1,
                    branches,
                    normalPathLabel,
                    isConditional: isConditionalNormalized,
                    isEndStep: step.toolTrigger === 'journey_complete',
                    hasBranching: branches.length > 0
                  };
                });

                // Find which steps are branch targets
                const branchTargetSteps = new Set<number>();
                flowNodes.forEach(fn => fn.branches.forEach(b => branchTargetSteps.add(b.targetStepNum)));

                // Build the two-lane flowchart: Main path (left) and Skip path (right)
                const renderStepNode = (node: FlowNode, lane: 'main' | 'skip') => {
                  const { step, stepNumber, isConditional, isEndStep } = node;
                  
                  return (
                    <div 
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-md w-[240px]
                        ${isConditional 
                          ? 'border-2 border-dashed border-purple-400 bg-purple-50/50 dark:bg-purple-950/30' 
                          : isEndStep 
                            ? 'border-2 border-green-400 bg-green-50 dark:bg-green-950/30'
                            : lane === 'skip'
                              ? 'border-2 border-orange-300 bg-orange-50 dark:bg-orange-950/30'
                              : 'border border-blue-200 bg-white dark:bg-gray-800 dark:border-blue-800'
                        }`}
                    >
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm text-white
                        ${isConditional ? 'bg-purple-500' : isEndStep ? 'bg-green-500' : lane === 'skip' ? 'bg-orange-500' : 'bg-blue-600'}`}>
                        {stepNumber}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-xs text-gray-900 dark:text-gray-100 line-clamp-2">
                          {step.questionText || step.toolTrigger}
                        </div>
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          {step.toolTrigger && step.toolTrigger !== 'none' && (
                            <span className="text-[9px] bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1 py-0.5 rounded">
                              {step.toolTrigger}
                            </span>
                          )}
                          {isConditional && (
                            <span className="text-[9px] bg-purple-200 dark:bg-purple-800 text-purple-700 dark:text-purple-200 px-1 py-0.5 rounded">
                              conditional
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                };

                // Build paths for visualization
                // Main path: steps that are not conditional (normal flow)
                // Skip path: conditional steps that are only reached via skip

                return (
                  <div className="flex flex-col items-center min-w-fit">
                    {/* Start Node */}
                    <div className="flex flex-col items-center mb-3">
                      <div className="w-12 h-12 rounded-full bg-green-500 text-white flex items-center justify-center shadow-lg">
                        <CircleDot className="w-6 h-6" />
                      </div>
                      <span className="text-xs font-medium text-green-600 mt-1">START</span>
                    </div>

                    {/* Two-lane flow */}
                    <div className="flex gap-16 relative">
                      {/* Left Lane: Main Path */}
                      <div className="flex flex-col items-center">
                        <div className="text-xs font-semibold text-blue-600 mb-3 px-3 py-1 bg-blue-50 rounded-full border border-blue-200">
                          Main Path
                        </div>
                        
                        {flowNodes.map((node, nodeIdx) => {
                          // Skip conditional steps in main path
                          if (node.isConditional) return null;
                          
                          const isLast = nodeIdx === flowNodes.length - 1 || 
                            flowNodes.slice(nodeIdx + 1).every(n => n.isConditional);
                          
                          return (
                            <div key={node.step.id} className="flex flex-col items-center">
                              {/* Arrow connector from previous */}
                              {nodeIdx > 0 && !flowNodes[nodeIdx - 1]?.isConditional && (
                                <div className="flex flex-col items-center mb-2">
                                  <div className="w-0.5 h-4 bg-blue-300 dark:bg-blue-600" />
                                  <ArrowDown className="w-4 h-4 text-blue-400 -mt-1" />
                                </div>
                              )}
                              
                              {/* Step Node */}
                              {renderStepNode(node, 'main')}
                              
                              {/* Branching indicator - shows when step has branches */}
                              {node.hasBranching && (
                                <div className="flex flex-col items-center mt-3">
                                  <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/50 border-2 border-orange-400 rotate-45 flex items-center justify-center shadow">
                                    <span className="text-orange-600 dark:text-orange-300 text-xs font-bold -rotate-45">?</span>
                                  </div>
                                  
                                  {/* Branch labels */}
                                  <div className="flex gap-8 mt-3 items-start flex-wrap justify-center">
                                    {/* Continue/Normal path */}
                                    <div className="flex flex-col items-center">
                                      <div className="px-2 py-1 bg-blue-100 dark:bg-blue-900/40 rounded-full border border-blue-300 text-[10px] font-semibold text-blue-700">
                                        "{node.normalPathLabel}"
                                      </div>
                                      <div className="w-0.5 h-4 bg-blue-300 mt-1" />
                                      <ArrowDown className="w-3 h-3 text-blue-400 -mt-0.5" />
                                      <span className="text-[9px] text-blue-600">Next step</span>
                                    </div>
                                    
                                    {/* Branch paths (skip + branchingCondition) */}
                                    {node.branches.map((branch, bIdx) => (
                                      <div key={bIdx} className="flex flex-col items-center">
                                        <div className={`px-2 py-1 rounded-full border text-[10px] font-semibold
                                          ${branch.type === 'skip' 
                                            ? 'bg-orange-100 dark:bg-orange-900/40 border-orange-300 text-orange-700' 
                                            : 'bg-purple-100 dark:bg-purple-900/40 border-purple-300 text-purple-700'
                                          }`}>
                                          "{branch.label}"
                                        </div>
                                        <div className="flex items-center gap-1 mt-1">
                                          <ArrowRight className={`w-3 h-3 ${branch.type === 'skip' ? 'text-orange-500' : 'text-purple-500'}`} />
                                          <span className={`text-[10px] font-medium ${branch.type === 'skip' ? 'text-orange-600' : 'text-purple-600'}`}>
                                            Step {branch.targetStepNum}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {/* End indicator */}
                              {node.isEndStep && (
                                <div className="flex flex-col items-center mt-3">
                                  <div className="w-0.5 h-4 bg-green-300" />
                                  <div className="w-10 h-10 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg">
                                    <CheckCircle2 className="w-5 h-5" />
                                  </div>
                                  <span className="text-xs font-medium text-red-600 mt-1">END</span>
                                </div>
                              )}
                              
                              {/* Spacer */}
                              {!isLast && !node.isEndStep && !node.hasBranching && (
                                <div className="h-2" />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Right Lane: Skip/Conditional Path */}
                      {flowNodes.some(n => n.isConditional) && (
                        <div className="flex flex-col items-center">
                          <div className="text-xs font-semibold text-orange-600 mb-3 px-3 py-1 bg-orange-50 rounded-full border border-orange-200">
                            Skip Path
                          </div>
                          
                          {flowNodes.map((node, nodeIdx) => {
                            // Only show conditional steps in skip path
                            if (!node.isConditional) return null;
                            
                            return (
                              <div key={node.step.id} className="flex flex-col items-center">
                                {/* Show which step skips to this */}
                                <div className="text-[10px] text-muted-foreground mb-2 italic">
                                  (jumped from decision)
                                </div>
                                
                                {/* Step Node */}
                                {renderStepNode(node, 'skip')}
                                
                                {/* Arrow to continue/end */}
                                <div className="flex flex-col items-center mt-2">
                                  <div className="w-0.5 h-4 bg-orange-300" />
                                  <ArrowDown className="w-4 h-4 text-orange-400 -mt-1" />
                                  <div className="text-[10px] text-muted-foreground mt-1">
                                    continues to Step {node.index + 2}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* End node if needed */}
                    {!flowNodes.some(n => n.isEndStep) && (
                      <div className="flex flex-col items-center mt-4">
                        <div className="w-0.5 h-4 bg-gray-300" />
                        <div className="w-10 h-10 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-medium text-red-600 mt-1">END</span>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
          
          {/* Legend */}
          <div className="px-6 py-3 border-t bg-gray-50/80 dark:bg-gray-900/50">
            <div className="flex items-center gap-6 text-xs text-muted-foreground flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-blue-600" />
                <span>Main Path Step</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded border-2 border-dashed border-purple-400 bg-purple-50" />
                <span>Conditional (skip-to only)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-orange-400 rounded-full rotate-45 border border-orange-500" />
                <span>Decision Point</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-green-500" />
                <span>Start</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-red-500" />
                <span>End</span>
              </div>
            </div>
          </div>
          
          <DialogFooter className="px-6 py-4 border-t flex-shrink-0">
            <Button variant="outline" onClick={() => setJourneyMapOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    These journey-specific instructions will work alongside your global Train Chroney instructions when this journey is active.
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
