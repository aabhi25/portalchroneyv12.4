import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
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
  MessageCircle,
  GitBranch,
  Edit,
  CheckCircle,
  Plus,
  Trash2,
  Play,
  Pause,
  GripVertical,
  ArrowLeft,
  Loader2,
  Info,
  Facebook,
  Sparkles,
  Clock,
  Settings,
} from "lucide-react";
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
import { SidebarTrigger } from "@/components/ui/sidebar";
import { format } from "date-fns";

interface FacebookFlow {
  id: string;
  name: string;
  description: string | null;
  isActive: string;
  triggerKeyword: string | null;
  fallbackToAI: string;
  sessionTimeout: number | null;
  completionMessage: string | null;
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

interface FacebookFlowStep {
  id: string;
  flowId: string;
  stepKey: string;
  stepOrder: number;
  type: string;
  prompt: string;
  options: {
    buttons?: { id: string; title: string }[];
    inputValidation?: string;
    requiredFields?: string[];
    selectedFields?: { fieldKey: string; fieldLabel: string; isRequired: boolean }[];
  } | null;
  nextStepMapping: Record<string, string> | null;
  defaultNextStep: string | null;
  saveToField: string | null;
  paused: boolean;
  createdAt: string;
}

const parseUTCDate = (dateString: string | Date): Date => {
  if (dateString instanceof Date) return dateString;
  const utcString = dateString.endsWith('Z') ? dateString : dateString + 'Z';
  return new Date(utcString);
};

const stepTypeIcons: Record<string, typeof MessageCircle> = {
  text: MessageCircle,
  buttons: GitBranch,
  input: Edit,
  end: CheckCircle,
};

const stepTypeLabels: Record<string, string> = {
  text: "Text Message",
  buttons: "Buttons",
  input: "Wait for Input",
  end: "End Flow",
};

interface SortableStepItemProps {
  step: FacebookFlowStep;
  index: number;
  onEdit: (step: FacebookFlowStep) => void;
  onDelete: (step: FacebookFlowStep) => void;
  onTogglePause: (step: FacebookFlowStep) => void;
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

  const StepIcon = stepTypeIcons[step.type] || MessageCircle;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-3 p-3 rounded-lg w-full overflow-hidden ${
        step.paused
          ? "bg-gray-100 border border-dashed border-gray-300"
          : "bg-gray-50 border border-gray-200"
      }`}
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
      <div
        className={`flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
          step.paused
            ? "bg-gray-200 text-gray-400"
            : "bg-gradient-to-r from-blue-100 to-blue-200 text-blue-700"
        }`}
      >
        {index + 1}
      </div>
      <div className="flex-shrink-0 mt-0.5">
        <StepIcon className={`h-4 w-4 ${step.paused ? "text-gray-400" : "text-blue-500"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={step.paused ? "opacity-50" : ""}>
            {stepTypeLabels[step.type] || step.type}
          </Badge>
          {step.paused && (
            <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700">
              Paused
            </Badge>
          )}
        </div>
        <p
          className={`text-sm break-words mt-1 ${
            step.paused ? "text-gray-400 line-through" : "text-gray-600"
          }`}
        >
          {step.prompt.length > 120 ? step.prompt.substring(0, 120) + "..." : step.prompt}
        </p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onTogglePause(step)}
              >
                {step.paused ? (
                  <Play className="h-4 w-4 text-green-600" />
                ) : (
                  <Pause className="h-4 w-4 text-amber-500" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{step.paused ? "Resume step" : "Pause step"}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(step)}>
          <Edit className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(step)}>
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      </div>
    </div>
  );
}

export default function FacebookFlows() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [selectedFlow, setSelectedFlow] = useState<FacebookFlow | null>(null);
  const [showNewFlowDialog, setShowNewFlowDialog] = useState(false);
  const [showEditFlowDialog, setShowEditFlowDialog] = useState(false);
  const [showStepDialog, setShowStepDialog] = useState(false);
  const [editingStep, setEditingStep] = useState<FacebookFlowStep | null>(null);
  const [editingFlow, setEditingFlow] = useState<FacebookFlow | null>(null);
  const [showDeleteFlowDialog, setShowDeleteFlowDialog] = useState(false);
  const [flowToDelete, setFlowToDelete] = useState<FacebookFlow | null>(null);
  const [showDeleteStepDialog, setShowDeleteStepDialog] = useState(false);
  const [stepToDelete, setStepToDelete] = useState<FacebookFlowStep | null>(null);

  const [newFlowName, setNewFlowName] = useState("");
  const [newFlowDescription, setNewFlowDescription] = useState("");
  const [newFlowTriggerKeyword, setNewFlowTriggerKeyword] = useState("");
  const [newFlowSessionTimeout, setNewFlowSessionTimeout] = useState("30");
  const [newFlowCompletionMessage, setNewFlowCompletionMessage] = useState(
    "Thank you! Your information has been recorded."
  );
  const [newFlowFallbackToAI, setNewFlowFallbackToAI] = useState(true);

  const [stepType, setStepType] = useState("text");
  const [stepPrompt, setStepPrompt] = useState("");
  const [stepButtons, setStepButtons] = useState<
    { id: string; title: string; nextStep?: string }[]
  >([]);
  const [stepDefaultNext, setStepDefaultNext] = useState("");
  const [stepSaveToField, setStepSaveToField] = useState("");
  const [stepInputValidation, setStepInputValidation] = useState("none");
  const [stepSelectedFields, setStepSelectedFields] = useState<
    { fieldKey: string; fieldLabel: string; isRequired: boolean }[]
  >([]);

  const { data: flowsData, isLoading: flowsLoading } = useQuery({
    queryKey: ["/api/facebook/flows"],
    queryFn: async () => {
      const data = await apiRequest("GET", "/api/facebook/flows");
      return data as { flows: FacebookFlow[] };
    },
  });

  const flows: FacebookFlow[] = flowsData?.flows || [];

  const { data: stepsData } = useQuery({
    queryKey: ["/api/facebook/flows", selectedFlow?.id, "steps"],
    queryFn: async () => {
      if (!selectedFlow) return { steps: [] };
      return (await apiRequest("GET", `/api/facebook/flows/${selectedFlow.id}`)) as {
        steps: FacebookFlowStep[];
      };
    },
    enabled: !!selectedFlow,
  });

  const { data: leadFieldsForFlow } = useQuery({
    queryKey: ["/api/facebook/lead-fields"],
    queryFn: async () => {
      const data = await apiRequest("GET", "/api/facebook/lead-fields");
      return data as { fields: LeadField[] };
    },
  });

  const createFlowMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/facebook/flows", {
        name: newFlowName,
        description: newFlowDescription || null,
        completionMessage: newFlowCompletionMessage || null,
        triggerKeyword: newFlowTriggerKeyword || null,
        sessionTimeout: parseInt(newFlowSessionTimeout) || 30,
        fallbackToAI: newFlowFallbackToAI ? "true" : "false",
      });
    },
    onSuccess: () => {
      toast({ title: "Flow created" });
      queryClient.invalidateQueries({ queryKey: ["/api/facebook/flows"] });
      setShowNewFlowDialog(false);
      resetFlowForm();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateFlowMutation = useMutation({
    mutationFn: async ({
      flowId,
      updates,
    }: {
      flowId: string;
      updates: Partial<FacebookFlow>;
    }) => {
      return await apiRequest("PUT", `/api/facebook/flows/${flowId}`, updates);
    },
    onSuccess: () => {
      toast({ title: "Flow updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/facebook/flows"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteFlowMutation = useMutation({
    mutationFn: async (flowId: string) => {
      return await apiRequest("DELETE", `/api/facebook/flows/${flowId}`);
    },
    onSuccess: () => {
      toast({ title: "Flow deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/facebook/flows"] });
      setSelectedFlow(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const createStepMutation = useMutation({
    mutationFn: async (stepData: any) => {
      return await apiRequest(
        "POST",
        `/api/facebook/flows/${selectedFlow?.id}/steps`,
        stepData
      );
    },
    onSuccess: () => {
      toast({ title: "Step created" });
      queryClient.invalidateQueries({
        queryKey: ["/api/facebook/flows", selectedFlow?.id, "steps"],
      });
      resetStepForm();
      setShowStepDialog(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateStepMutation = useMutation({
    mutationFn: async ({ stepId, updates }: { stepId: string; updates: any }) => {
      return await apiRequest(
        "PUT",
        `/api/facebook/flows/${selectedFlow?.id}/steps/${stepId}`,
        updates
      );
    },
    onSuccess: () => {
      toast({ title: "Step updated" });
      queryClient.invalidateQueries({
        queryKey: ["/api/facebook/flows", selectedFlow?.id, "steps"],
      });
      resetStepForm();
      setShowStepDialog(false);
      setEditingStep(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const togglePauseMutation = useMutation({
    mutationFn: async (step: FacebookFlowStep) => {
      return await apiRequest(
        "PATCH",
        `/api/facebook/flows/${selectedFlow?.id}/steps/${step.id}/toggle-pause`
      );
    },
    onMutate: async (step: FacebookFlowStep) => {
      const queryKey = ["/api/facebook/flows", selectedFlow?.id, "steps"];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old: any) => {
        if (!old?.steps) return old;
        return {
          ...old,
          steps: old.steps.map((s: FacebookFlowStep) =>
            s.id === step.id ? { ...s, paused: !s.paused } : s
          ),
        };
      });
      return { previous };
    },
    onError: (_err: any, _step: any, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["/api/facebook/flows", selectedFlow?.id, "steps"],
          context.previous
        );
      }
      toast({ title: "Error", description: "Failed to update step", variant: "destructive" });
    },
    onSuccess: (data: any, step: FacebookFlowStep) => {
      const isPaused = data.step?.paused;
      const queryKey = ["/api/facebook/flows", selectedFlow?.id, "steps"];
      if (data.step) {
        queryClient.setQueryData(queryKey, (old: any) => {
          if (!old?.steps) return old;
          return {
            ...old,
            steps: old.steps.map((s: FacebookFlowStep) =>
              s.id === step.id ? { ...s, ...data.step } : s
            ),
          };
        });
      }
      toast({
        title: isPaused ? "Step paused" : "Step resumed",
        description: isPaused
          ? "This step will be skipped during the flow"
          : "This step is now active again",
      });
    },
  });

  const deleteStepMutation = useMutation({
    mutationFn: async (stepId: string) => {
      return await apiRequest(
        "DELETE",
        `/api/facebook/flows/${selectedFlow?.id}/steps/${stepId}`
      );
    },
    onSuccess: () => {
      toast({ title: "Step deleted" });
      queryClient.invalidateQueries({
        queryKey: ["/api/facebook/flows", selectedFlow?.id, "steps"],
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const reorderStepsMutation = useMutation({
    mutationFn: async (stepIds: string[]) => {
      return await apiRequest(
        "POST",
        `/api/facebook/flows/${selectedFlow?.id}/steps/reorder`,
        { stepIds }
      );
    },
    onSuccess: () => {
      toast({ title: "Steps reordered" });
      queryClient.invalidateQueries({
        queryKey: ["/api/facebook/flows", selectedFlow?.id, "steps"],
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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

  const resetFlowForm = () => {
    setNewFlowName("");
    setNewFlowDescription("");
    setNewFlowTriggerKeyword("");
    setNewFlowSessionTimeout("30");
    setNewFlowCompletionMessage("Thank you! Your information has been recorded.");
    setNewFlowFallbackToAI(true);
  };

  const resetStepForm = () => {
    setStepType("text");
    setStepPrompt("");
    setStepButtons([]);
    setStepDefaultNext("");
    setStepSaveToField("");
    setStepInputValidation("none");
    setStepSelectedFields([]);
  };

  const openEditFlowDialog = (flow: FacebookFlow) => {
    setEditingFlow(flow);
    setNewFlowName(flow.name);
    setNewFlowDescription(flow.description || "");
    setNewFlowTriggerKeyword(flow.triggerKeyword || "");
    setNewFlowSessionTimeout(flow.sessionTimeout?.toString() || "30");
    setNewFlowCompletionMessage(
      flow.completionMessage || "Thank you! Your information has been recorded."
    );
    setNewFlowFallbackToAI(flow.fallbackToAI === "true");
    setShowEditFlowDialog(true);
  };

  const closeEditFlowDialog = () => {
    setShowEditFlowDialog(false);
    setEditingFlow(null);
    resetFlowForm();
  };

  const openStepDialog = (step?: FacebookFlowStep) => {
    if (step) {
      setEditingStep(step);
      setStepType(step.type);
      setStepPrompt(step.prompt);
      const buttons = step.options?.buttons || [];
      const nextMapping = step.nextStepMapping || {};
      setStepButtons(
        buttons.map((btn) => ({ ...btn, nextStep: nextMapping[btn.id] || "" }))
      );
      setStepDefaultNext(step.defaultNextStep || "");
      setStepSaveToField(step.saveToField || "");
      setStepInputValidation(step.options?.inputValidation || "none");
      const selectedFields = step.options?.selectedFields || [];
      setStepSelectedFields(selectedFields);
    } else {
      resetStepForm();
      setEditingStep(null);
    }
    setShowStepDialog(true);
  };

  const generateStepKey = () => {
    if (editingStep) return editingStep.stepKey;
    const steps = stepsData?.steps || [];
    return String(steps.length + 1);
  };

  const getAvailableSteps = () => {
    const steps = stepsData?.steps || [];
    const currentStepKey = editingStep?.stepKey;
    const filteredSteps = currentStepKey
      ? steps.filter((s) => s.stepKey !== currentStepKey)
      : steps;
    const options = filteredSteps.map((s) => ({
      value: s.stepKey,
      label: `Step ${s.stepKey}`,
    }));
    return options;
  };

  const handleSaveStep = () => {
    const stepKey = editingStep?.stepKey || generateStepKey();
    const nextStepMapping: Record<string, string> = {};
    stepButtons.forEach((btn) => {
      if (btn.nextStep) {
        nextStepMapping[btn.id] = btn.nextStep;
      }
    });

    let options: any = null;
    if (stepType === "buttons" && stepButtons.length > 0) {
      options = { buttons: stepButtons.map((b) => ({ id: b.id, title: b.title })) };
    }

    if (stepType === "input") {
      options = options || {};
      if (stepInputValidation && stepInputValidation !== "none") {
        options.inputValidation = stepInputValidation;
      }
      if (stepSelectedFields.length > 0) {
        options.selectedFields = stepSelectedFields;
        options.requiredFields = stepSelectedFields
          .filter((f) => f.isRequired)
          .map((f) => f.fieldKey);
      }
    }

    const stepData = {
      stepKey,
      stepOrder: editingStep
        ? stepsData?.steps?.findIndex((s) => s.id === editingStep.id) || 0
        : stepsData?.steps?.length || 0,
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
      setStepButtons([
        ...stepButtons,
        { id: `btn_${stepButtons.length + 1}`, title: "", nextStep: "" },
      ]);
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

  const addSelectedField = () => {
    setStepSelectedFields([
      ...stepSelectedFields,
      { fieldKey: "", fieldLabel: "", isRequired: false },
    ]);
  };

  const updateSelectedField = (
    index: number,
    field: "fieldKey" | "fieldLabel" | "isRequired",
    value: string | boolean
  ) => {
    const updated = [...stepSelectedFields];
    updated[index] = { ...updated[index], [field]: value };
    setStepSelectedFields(updated);
  };

  const removeSelectedField = (index: number) => {
    setStepSelectedFields(stepSelectedFields.filter((_, i) => i !== index));
  };

  const availableSteps = getAvailableSteps();

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-50 flex items-center gap-4 border-b bg-gradient-to-r from-blue-600 to-blue-500 px-4 h-14 shrink-0">
        <SidebarTrigger className="text-white hover:bg-blue-700/50" />
        <Button variant="ghost" size="sm" onClick={() => selectedFlow ? setSelectedFlow(null) : setLocation("/admin/facebook")} className="gap-1 text-white/80 hover:text-white hover:bg-blue-700/50">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        {selectedFlow ? (
          <>
            <div className="flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-white" />
              <h1 className="text-lg font-semibold text-white">{selectedFlow.name}</h1>
              <Badge
                variant={selectedFlow.isActive === "true" ? "default" : "secondary"}
                className={
                  selectedFlow.isActive === "true"
                    ? "bg-white/20 text-white border-white/30"
                    : "bg-white/10 text-white/70"
                }
              >
                {selectedFlow.isActive === "true" ? "Active" : "Inactive"}
              </Badge>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-lg bg-white/20">
              <Facebook className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-semibold text-white">Facebook AI Flows</h1>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {!selectedFlow ? (
          <div className="max-w-4xl mx-auto space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-blue-600" />
                    <CardTitle>Conversation Flows</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowNewFlowDialog(true)}>
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setShowNewFlowDialog(true)}
                      className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600"
                    >
                      <Plus className="h-4 w-4 mr-1" /> New Flow
                    </Button>
                  </div>
                </div>
                <CardDescription>
                  Create structured conversation flows with buttons and quick replies for guided Facebook Messenger interactions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {flowsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : flows.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No flows created yet. Create your first conversation flow to guide Facebook Messenger interactions.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {flows.map((flow) => (
                      <div
                        key={flow.id}
                        className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                          selectedFlow?.id === flow.id ? "border-blue-500 bg-blue-50" : "hover:border-gray-300"
                        }`}
                        onClick={() => setSelectedFlow(flow)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${flow.isActive === "true" ? "bg-gradient-to-r from-blue-100 to-blue-200" : "bg-gray-100"}`}>
                              {flow.isActive === "true" ? (
                                <Play className="h-4 w-4 text-blue-600" />
                              ) : (
                                <Pause className="h-4 w-4 text-gray-400" />
                              )}
                            </div>
                            <div>
                              <h4 className="font-medium">{flow.name}</h4>
                              {flow.description && <p className="text-sm text-gray-500">{flow.description}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={flow.isActive === "true"}
                              onCheckedChange={(checked) => {
                                updateFlowMutation.mutate({
                                  flowId: flow.id,
                                  updates: { isActive: checked ? "true" : "false" },
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
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
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <GitBranch className="h-5 w-5 text-blue-500" />
                      Flow Steps
                    </CardTitle>
                    <CardDescription>
                      Define the conversation steps for this flow. Drag to reorder.
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => openStepDialog()}
                    className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600"
                  >
                    <Plus className="h-4 w-4 mr-1" /> Add Step
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!stepsData?.steps?.length ? (
                  <div className="text-center py-12">
                    <div className="p-3 rounded-full bg-gray-100 inline-block mb-3">
                      <MessageCircle className="h-6 w-6 text-gray-400" />
                    </div>
                    <p className="text-muted-foreground">
                      No steps yet. Add your first step to define the conversation flow.
                    </p>
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={stepsData.steps.map((s) => s.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {stepsData.steps.map((step, index) => (
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Flow Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Trigger Keyword</span>
                    <p className="font-medium">
                      {selectedFlow.triggerKeyword || "Any message (auto-start)"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Session Timeout</span>
                    <p className="font-medium">
                      {selectedFlow.sessionTimeout || 30} minutes
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Fallback to AI</span>
                    <p className="font-medium">
                      {selectedFlow.fallbackToAI === "true" ? "Enabled" : "Disabled"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Completion Message</span>
                    <p className="font-medium truncate">
                      {selectedFlow.completionMessage || "None"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <Dialog open={showNewFlowDialog} onOpenChange={setShowNewFlowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Flow</DialogTitle>
            <DialogDescription>
              Define a new conversation flow for Facebook Messenger
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Flow Name</Label>
              <Input
                value={newFlowName}
                onChange={(e) => setNewFlowName(e.target.value)}
                placeholder="e.g., Welcome Flow"
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
              <div className="flex items-center gap-2 mb-1">
                <Label>Trigger Keyword (optional)</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-gray-400" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      If set, the flow only starts when user sends this exact keyword. Leave
                      empty to start immediately on any message.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                value={newFlowTriggerKeyword}
                onChange={(e) => setNewFlowTriggerKeyword(e.target.value)}
                placeholder="e.g., start, help, menu"
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label>Session Timeout (minutes)</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-gray-400" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      After this many minutes of inactivity, the flow resets.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
              <Label>Completion Message</Label>
              <Input
                value={newFlowCompletionMessage}
                onChange={(e) => setNewFlowCompletionMessage(e.target.value)}
                placeholder="Thank you! Your information has been recorded."
              />
              <p className="text-xs text-muted-foreground mt-1">
                Message sent when the flow is completed
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Fallback to AI</Label>
                <p className="text-xs text-muted-foreground">
                  Use AI to handle unexpected responses
                </p>
              </div>
              <Switch
                checked={newFlowFallbackToAI}
                onCheckedChange={setNewFlowFallbackToAI}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewFlowDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createFlowMutation.mutate()}
              disabled={!newFlowName || createFlowMutation.isPending}
              className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600"
            >
              {createFlowMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Flow"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showEditFlowDialog}
        onOpenChange={(open) => !open && closeEditFlowDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Flow Settings</DialogTitle>
            <DialogDescription>
              Configure how this flow is triggered and behaves
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Flow Name</Label>
              <Input
                value={newFlowName}
                onChange={(e) => setNewFlowName(e.target.value)}
                placeholder="e.g., Welcome Flow"
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
              <div className="flex items-center gap-2 mb-1">
                <Label>Trigger Keyword (optional)</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-gray-400" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      If set, the flow only starts when user sends this exact keyword.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                value={newFlowTriggerKeyword}
                onChange={(e) => setNewFlowTriggerKeyword(e.target.value)}
                placeholder="e.g., start, help, menu"
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label>Session Timeout (minutes)</Label>
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
              <Label>Completion Message</Label>
              <Input
                value={newFlowCompletionMessage}
                onChange={(e) => setNewFlowCompletionMessage(e.target.value)}
                placeholder="Thank you! Your information has been recorded."
              />
              <p className="text-xs text-muted-foreground mt-1">
                Message sent when the flow is completed
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Fallback to AI</Label>
                <p className="text-xs text-muted-foreground">
                  Use AI to handle unexpected responses
                </p>
              </div>
              <Switch
                checked={newFlowFallbackToAI}
                onCheckedChange={setNewFlowFallbackToAI}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEditFlowDialog}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingFlow) {
                  updateFlowMutation.mutate({
                    flowId: editingFlow.id,
                    updates: {
                      name: newFlowName,
                      description: newFlowDescription || null,
                      triggerKeyword: newFlowTriggerKeyword || null,
                      sessionTimeout: parseInt(newFlowSessionTimeout) || 30,
                      completionMessage: newFlowCompletionMessage || null,
                      fallbackToAI: newFlowFallbackToAI ? "true" : "false",
                    },
                  });
                  closeEditFlowDialog();
                }
              }}
              disabled={!newFlowName}
              className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteFlowDialog} onOpenChange={setShowDeleteFlowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Flow</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{flowToDelete?.name}"? This action cannot be
              undone and will remove all steps associated with this flow.
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
              Are you sure you want to delete Step {stepToDelete?.stepKey}? This action cannot
              be undone.
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

      <Dialog open={showStepDialog} onOpenChange={setShowStepDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingStep ? "Edit Step" : "Add New Step"}</DialogTitle>
            <DialogDescription>
              {editingStep
                ? `Editing Step ${editingStep.stepKey}`
                : `This will be Step ${(stepsData?.steps?.length || 0) + 1}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto flex-1 pr-2">
            <div>
              <Label>Step Type</Label>
              <Select value={stepType} onValueChange={setStepType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">
                    <span className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4" />
                      Text Message
                    </span>
                  </SelectItem>
                  <SelectItem value="buttons">
                    <span className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4" />
                      Buttons (max 3)
                    </span>
                  </SelectItem>
                  <SelectItem value="input">
                    <span className="flex items-center gap-2">
                      <Edit className="h-4 w-4" />
                      Wait for Input
                    </span>
                  </SelectItem>
                  <SelectItem value="end">
                    <span className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      End Flow
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{stepType === "end" ? "Completion Message" : "Message"}</Label>
              <Textarea
                value={stepPrompt}
                onChange={(e) => setStepPrompt(e.target.value)}
                placeholder={
                  stepType === "end"
                    ? "Enter the completion message"
                    : "Enter the message to send"
                }
                rows={3}
              />
            </div>

            {stepType === "text" && (
              <>
                <div>
                  <Label>Save Response to Field (optional)</Label>
                  <Select
                    value={stepSaveToField || "__none__"}
                    onValueChange={(v) => setStepSaveToField(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger>
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
                <div>
                  <Label>Default Next Step</Label>
                  <Select
                    value={stepDefaultNext || "__auto__"}
                    onValueChange={(v) => setStepDefaultNext(v === "__auto__" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Next step in sequence" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Next step in sequence</SelectItem>
                      {availableSteps.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="end">End Flow</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {stepType === "buttons" && (
              <>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Buttons</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addButton}
                      disabled={stepButtons.length >= 3}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Button
                    </Button>
                  </div>
                  {stepButtons.map((btn, idx) => (
                    <div key={idx} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Button {idx + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeButton(idx)}
                        >
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Button ID</Label>
                          <Input
                            value={btn.id}
                            onChange={(e) => updateButton(idx, "id", e.target.value)}
                            placeholder="btn_1"
                            className="h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Button Title</Label>
                          <Input
                            value={btn.title}
                            onChange={(e) => updateButton(idx, "title", e.target.value)}
                            placeholder="Option text"
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">Go to Step</Label>
                        <Select
                          value={btn.nextStep || "__auto__"}
                          onValueChange={(v) =>
                            updateButton(idx, "nextStep", v === "__auto__" ? "" : v)
                          }
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Next step in sequence" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__auto__">Next step in sequence</SelectItem>
                            {availableSteps.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                            <SelectItem value="end">End Flow</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                  {stepButtons.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      Add up to 3 buttons for user selection
                    </p>
                  )}
                </div>
                <div>
                  <Label>Default Next Step</Label>
                  <Select
                    value={stepDefaultNext || "__auto__"}
                    onValueChange={(v) => setStepDefaultNext(v === "__auto__" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Next step in sequence" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Next step in sequence</SelectItem>
                      {availableSteps.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="end">End Flow</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {stepType === "input" && (
              <>
                <div>
                  <Label>Input Validation</Label>
                  <Select value={stepInputValidation} onValueChange={setStepInputValidation}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="phone">Phone</SelectItem>
                      <SelectItem value="url">URL</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Save Response to Field (optional)</Label>
                  <Select
                    value={stepSaveToField || "__none__"}
                    onValueChange={(v) => setStepSaveToField(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger>
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
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Selected Fields</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addSelectedField}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Field
                    </Button>
                  </div>
                  {stepSelectedFields.map((field, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 border rounded-lg p-2"
                    >
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <Input
                          value={field.fieldKey}
                          onChange={(e) =>
                            updateSelectedField(idx, "fieldKey", e.target.value)
                          }
                          placeholder="Field key"
                          className="h-8 text-sm"
                        />
                        <Input
                          value={field.fieldLabel}
                          onChange={(e) =>
                            updateSelectedField(idx, "fieldLabel", e.target.value)
                          }
                          placeholder="Label"
                          className="h-8 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedField(idx, "isRequired", !field.isRequired)
                        }
                        className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${
                          field.isRequired
                            ? "bg-red-100 text-red-700 hover:bg-red-200"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        {field.isRequired ? "Required" : "Optional"}
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => removeSelectedField(idx)}
                      >
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div>
                  <Label>Default Next Step</Label>
                  <Select
                    value={stepDefaultNext || "__auto__"}
                    onValueChange={(v) => setStepDefaultNext(v === "__auto__" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Next step in sequence" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Next step in sequence</SelectItem>
                      {availableSteps.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="end">End Flow</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowStepDialog(false);
                setEditingStep(null);
                resetStepForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveStep}
              disabled={
                !stepPrompt ||
                createStepMutation.isPending ||
                updateStepMutation.isPending
              }
              className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600"
            >
              {createStepMutation.isPending || updateStepMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : editingStep ? (
                "Save Changes"
              ) : (
                "Add Step"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
