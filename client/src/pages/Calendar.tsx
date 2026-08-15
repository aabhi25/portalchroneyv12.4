import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, Plus, Calendar as CalendarIcon, Clock, CheckCircle2, XCircle, User, TrendingUp, Shield, Zap, Power, X, Pencil, AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format, isSameDay, parseISO, startOfDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface ScheduleTemplate {
  id: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  slotDurationMinutes: string;
  isActive: string;
}

interface SlotOverride {
  id: string;
  slotDate: string;
  slotTime: string;
  durationMinutes: string;
  isAvailable: string;
  isAllDay: string;
  reason: string;
}

interface Appointment {
  id: string;
  patientName: string;
  patientPhone: string;
  patientEmail: string;
  appointmentDate: string;
  appointmentTime: string;
  durationMinutes: string;
  status: string;
  notes: string;
}

interface AppointmentSuggestRule {
  id: string;
  keywords: string[];
  prompt: string;
  enabled: boolean;
}

const DAYS_OF_WEEK = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

// Validation helper functions
const convertToMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const timeRangesOverlap = (start1: string, end1: string, start2: string, end2: string): boolean => {
  const s1 = convertToMinutes(start1);
  const e1 = convertToMinutes(end1);
  const s2 = convertToMinutes(start2);
  const e2 = convertToMinutes(end2);
  return s1 < e2 && s2 < e1;
};

interface DayScheduleState {
  dayOfWeek: string;
  ranges: Array<{ startTime: string; endTime: string; source: string }>;
}

const buildDayScheduleState = (
  dayOfWeek: string,
  workingSchedules: ScheduleTemplate[],
  pendingChanges: {
    additions: Array<{ dayOfWeek: string; startTime: string; endTime: string; tempId?: string }>;
    updates: Map<string, { startTime: string; endTime: string; slotDurationMinutes: string }>;
    deletions: Set<string>;
  }
): DayScheduleState => {
  const ranges: Array<{ startTime: string; endTime: string; source: string }> = [];
  
  // Add existing schedules (with updates applied, excluding deletions)
  workingSchedules
    .filter(s => s.dayOfWeek === dayOfWeek && !pendingChanges.deletions.has(s.id))
    .forEach(s => {
      const updated = pendingChanges.updates.get(s.id);
      ranges.push({
        startTime: updated?.startTime || s.startTime,
        endTime: updated?.endTime || s.endTime,
        source: `existing-${s.id}`
      });
    });
  
  // Add pending additions
  pendingChanges.additions
    .filter(a => a.dayOfWeek === dayOfWeek)
    .forEach(a => {
      ranges.push({
        startTime: a.startTime,
        endTime: a.endTime,
        source: `addition-${a.tempId}`
      });
    });
  
  return { dayOfWeek, ranges };
};

const validateTimeRanges = (dayState: DayScheduleState): { valid: boolean; error?: string } => {
  const { ranges } = dayState;
  
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (timeRangesOverlap(ranges[i].startTime, ranges[i].endTime, ranges[j].startTime, ranges[j].endTime)) {
        return {
          valid: false,
          error: `Time range ${ranges[i].startTime} - ${ranges[i].endTime} overlaps with ${ranges[j].startTime} - ${ranges[j].endTime}`
        };
      }
    }
  }
  
  return { valid: true };
};

export default function Calendar() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("schedule");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [showForm, setShowForm] = useState(false);
  const [editingOverride, setEditingOverride] = useState<SlotOverride | null>(null);
  const [formError, setFormError] = useState<string>("");
  const [addingForDay, setAddingForDay] = useState("");
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editingScheduleData, setEditingScheduleData] = useState<{
    startTime: string;
    endTime: string;
    slotDurationMinutes: string;
  }>({
    startTime: "09:00",
    endTime: "17:00",
    slotDurationMinutes: "30",
  });
  const [newTimeRange, setNewTimeRange] = useState<{
    dayOfWeek: string;
    startTime: string;
    endTime: string;
    slotDurationMinutes: string;
  }>({
    dayOfWeek: "",
    startTime: "09:00",
    endTime: "17:00",
    slotDurationMinutes: "30",
  });

  // Edit mode state for batch saving
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<{
    additions: Array<{ dayOfWeek: string; startTime: string; endTime: string; slotDurationMinutes: string; tempId: string }>;
    updates: Map<string, { startTime: string; endTime: string; slotDurationMinutes: string }>;
    deletions: Set<string>;
    closedDays: Set<string>;
  }>({
    additions: [],
    updates: new Map(),
    deletions: new Set(),
    closedDays: new Set(),
  });
  
  // Working copy of schedules for edit mode (includes pending changes)
  const [workingSchedules, setWorkingSchedules] = useState<ScheduleTemplate[]>([]);

  // Appointment date filter state
  const [filterDate, setFilterDate] = useState<Date | undefined>();

  // Trigger rules state
  const [triggerRules, setTriggerRules] = useState<AppointmentSuggestRule[]>([]);
  const [showTriggerModal, setShowTriggerModal] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<AppointmentSuggestRule | null>(null);
  const [newTrigger, setNewTrigger] = useState({
    keywords: "",
    prompt: "Would you like me to schedule an appointment for you?",
  });

  const [newOverride, setNewOverride] = useState({
    slotDate: format(new Date(), "yyyy-MM-dd"),
    slotTime: "09:00",
    endTime: "09:30",
    isAvailable: "false",
    isAllDay: "false",
    reason: "",
  });

  const { data: scheduleTemplates = [], isLoading: loadingTemplates } = useQuery<ScheduleTemplate[]>({
    queryKey: ["/api/schedule-templates"],
  });

  const { data: appointments = [], isLoading: loadingAppointments } = useQuery<Appointment[]>({
    queryKey: ["/api/appointments"],
  });

  const { data: slotOverrides = [], isLoading: loadingOverrides } = useQuery<SlotOverride[]>({
    queryKey: ["/api/slot-overrides"],
    queryFn: async () => {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 6);
      
      const res = await fetch(
        `/api/slot-overrides?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const { data: widgetSettings } = useQuery<any>({
    queryKey: ["/api/widget-settings"],
  });

  const toggleAppointmentBookingMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await fetch("/api/widget-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ appointmentBookingEnabled: enabled ? "true" : "false" }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/widget-settings"] });
    },
  });

  // Sync trigger rules from widget settings
  useEffect(() => {
    if (widgetSettings?.appointmentSuggestRules) {
      setTriggerRules(widgetSettings.appointmentSuggestRules);
    }
  }, [widgetSettings?.appointmentSuggestRules]);

  const updateTriggerRulesMutation = useMutation({
    mutationFn: async (rules: AppointmentSuggestRule[]) => {
      const res = await fetch("/api/widget-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ appointmentSuggestRules: rules }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/widget-settings"] });
      toast({ title: "Trigger rules updated" });
    },
  });

  const saveTriggerRule = () => {
    const keywords = newTrigger.keywords.split(",").map(k => k.trim()).filter(k => k);
    if (keywords.length === 0) {
      toast({ title: "Please enter at least one keyword", variant: "destructive" });
      return;
    }
    if (!newTrigger.prompt.trim()) {
      toast({ title: "Please enter a prompt", variant: "destructive" });
      return;
    }

    let updatedRules: AppointmentSuggestRule[];
    if (editingTrigger) {
      updatedRules = triggerRules.map(r => 
        r.id === editingTrigger.id 
          ? { ...r, keywords, prompt: newTrigger.prompt.trim() }
          : r
      );
    } else {
      const newRule: AppointmentSuggestRule = {
        id: `rule_${Date.now()}`,
        keywords,
        prompt: newTrigger.prompt.trim(),
        enabled: true,
      };
      updatedRules = [...triggerRules, newRule];
    }

    setTriggerRules(updatedRules);
    updateTriggerRulesMutation.mutate(updatedRules);
    setShowTriggerModal(false);
    setEditingTrigger(null);
    setNewTrigger({ keywords: "", prompt: "Would you like me to schedule an appointment for you?" });
  };

  const deleteTriggerRule = (ruleId: string) => {
    const updatedRules = triggerRules.filter(r => r.id !== ruleId);
    setTriggerRules(updatedRules);
    updateTriggerRulesMutation.mutate(updatedRules);
  };

  const toggleTriggerRule = (ruleId: string, enabled: boolean) => {
    const updatedRules = triggerRules.map(r => 
      r.id === ruleId ? { ...r, enabled } : r
    );
    setTriggerRules(updatedRules);
    updateTriggerRulesMutation.mutate(updatedRules);
  };

  const createTemplateMutation = useMutation({
    mutationFn: async (template: { dayOfWeek: string; startTime: string; endTime: string; slotDurationMinutes: string; isActive: string }) => {
      const res = await fetch("/api/schedule-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(template),
      });
      if (!res.ok) throw new Error(`Failed to create schedule for day ${template.dayOfWeek}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      setNewTimeRange({
        dayOfWeek: "",
        startTime: "09:00",
        endTime: "17:00",
        slotDurationMinutes: "30",
      });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { startTime: string; endTime: string; slotDurationMinutes: string } }) => {
      const res = await fetch(`/api/schedule-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      setEditingScheduleId(null);
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/schedule-templates/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
    },
  });

  const resetOverrideForm = () => {
    setNewOverride({
      slotDate: selectedDate ? format(selectedDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
      slotTime: "09:00",
      endTime: "09:30",
      isAvailable: "false",
      isAllDay: "false",
      reason: "",
    });
    setEditingOverride(null);
    setFormError("");
  };

  const calculateDuration = (startTime: string, endTime: string): number | null => {
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);
    
    const startTotalMinutes = startHours * 60 + startMinutes;
    const endTotalMinutes = endHours * 60 + endMinutes;
    
    const duration = endTotalMinutes - startTotalMinutes;
    
    // Return null if duration is zero or negative
    if (duration <= 0) {
      return null;
    }
    
    return duration;
  };

  const createOverrideMutation = useMutation({
    mutationFn: async (override: typeof newOverride) => {
      let durationMinutes: number;
      
      if (override.isAllDay === "true") {
        durationMinutes = 0;
      } else {
        const calculated = calculateDuration(override.slotTime, override.endTime);
        if (calculated === null) {
          throw new Error("Invalid time range");
        }
        durationMinutes = calculated;
      }
      
      const payload = {
        slotDate: new Date(override.slotDate).toISOString(),
        slotTime: override.slotTime,
        durationMinutes: durationMinutes,
        isAvailable: override.isAvailable,
        isAllDay: override.isAllDay,
        reason: override.reason,
      };
      
      const res = await fetch("/api/slot-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/slot-overrides"] });
      resetOverrideForm();
    },
  });

  const updateOverrideMutation = useMutation({
    mutationFn: async ({ id, override }: { id: string; override: typeof newOverride }) => {
      let durationMinutes: number;
      
      if (override.isAllDay === "true") {
        durationMinutes = 0;
      } else {
        const calculated = calculateDuration(override.slotTime, override.endTime);
        if (calculated === null) {
          throw new Error("Invalid time range");
        }
        durationMinutes = calculated;
      }
      
      const payload = {
        slotDate: new Date(override.slotDate).toISOString(),
        slotTime: override.slotTime,
        durationMinutes: durationMinutes,
        isAvailable: override.isAvailable,
        isAllDay: override.isAllDay,
        reason: override.reason,
      };
      
      const res = await fetch(`/api/slot-overrides/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/slot-overrides"] });
      resetOverrideForm();
    },
  });

  const deleteOverrideMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/slot-overrides/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/slot-overrides"] });
    },
  });

  const updateAppointmentStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/appointments/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/appointments"] });
    },
  });

  // Enter edit mode - initialize working copy
  const enterEditMode = () => {
    setIsEditMode(true);
    setWorkingSchedules([...scheduleTemplates]);
    
    // Initialize closedDays with days that currently have no schedules
    const initialClosedDays = new Set<string>();
    DAYS_OF_WEEK.forEach((day) => {
      const hasSchedules = scheduleTemplates.some(t => t.dayOfWeek === day.value);
      if (!hasSchedules) {
        initialClosedDays.add(day.value);
      }
    });
    
    setPendingChanges({
      additions: [],
      updates: new Map(),
      deletions: new Set(),
      closedDays: initialClosedDays,
    });
    setAddingForDay("");
  };

  // Cancel edit mode - discard all changes
  const handleCancelChanges = () => {
    setIsEditMode(false);
    setWorkingSchedules([]);
    setPendingChanges({
      additions: [],
      updates: new Map(),
      deletions: new Set(),
      closedDays: new Set(),
    });
    setAddingForDay("");
  };

  // Batch save all pending changes
  const handleSaveChanges = async () => {
    // Validate all days before saving
    for (const day of DAYS_OF_WEEK) {
      // Skip validation for closed days (they'll be deleted anyway)
      if (pendingChanges.closedDays.has(day.value)) {
        continue;
      }
      
      const dayState = buildDayScheduleState(day.value, workingSchedules, pendingChanges);
      const validation = validateTimeRanges(dayState);
      
      if (!validation.valid) {
        toast({
          title: "Cannot save changes",
          description: `${day.label}: ${validation.error}. Please fix overlapping time ranges before saving.`,
          variant: "destructive",
        });
        return; // Abort save
      }
    }
    
    setIsSaving(true);
    try {
      // Track deleted IDs to avoid double-deletion
      const alreadyDeleted = new Set<string>();

      // Process closed days (delete all schedules for these days)
      for (const dayOfWeek of Array.from(pendingChanges.closedDays)) {
        const daySchedules = workingSchedules.filter(s => s.dayOfWeek === dayOfWeek);
        for (const schedule of daySchedules) {
          await deleteTemplateMutation.mutateAsync(schedule.id);
          alreadyDeleted.add(schedule.id); // Track deleted IDs
        }
      }

      // Process deletions
      for (const scheduleId of Array.from(pendingChanges.deletions)) {
        if (!alreadyDeleted.has(scheduleId)) { // Skip if already deleted
          await deleteTemplateMutation.mutateAsync(scheduleId);
        }
      }

      // Process updates
      for (const [scheduleId, data] of Array.from(pendingChanges.updates.entries())) {
        await updateTemplateMutation.mutateAsync({ id: scheduleId, data });
      }

      // Process additions
      for (const addition of pendingChanges.additions) {
        await createTemplateMutation.mutateAsync({
          dayOfWeek: addition.dayOfWeek,
          startTime: addition.startTime,
          endTime: addition.endTime,
          slotDurationMinutes: addition.slotDurationMinutes,
          isActive: "true",
        });
      }

      // Exit edit mode and refresh data
      setIsEditMode(false);
      setWorkingSchedules([]);
      setPendingChanges({
        additions: [],
        updates: new Map(),
        deletions: new Set(),
        closedDays: new Set(),
      });
      setAddingForDay("");
      
      // Refresh the schedule templates
      await queryClient.invalidateQueries({ queryKey: ["/api/schedule-templates"] });
      
      toast({
        title: "Schedule updated",
        description: "Your weekly schedule has been saved successfully.",
      });
    } catch (error) {
      console.error("Failed to save changes:", error);
      toast({
        title: "Error saving changes",
        description: "Failed to save schedule. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Sync selectedDate with form and show form
  useEffect(() => {
    if (selectedDate) {
      setNewOverride(prev => ({
        ...prev,
        slotDate: format(selectedDate, "yyyy-MM-dd")
      }));
      setShowForm(true);
    }
  }, [selectedDate]);

  // Helper functions for calendar date indicators
  const getBlocksForDate = (date: Date) => {
    return slotOverrides.filter(override => {
      try {
        const overrideDate = parseISO(override.slotDate);
        return isSameDay(overrideDate, date);
      } catch {
        return false;
      }
    });
  };

  const dateHasAllDayBlock = (date: Date) => {
    return getBlocksForDate(date).some(block => block.isAllDay === "true");
  };

  const dateHasTimeSpecificBlock = (date: Date) => {
    return getBlocksForDate(date).some(block => block.isAllDay === "false");
  };

  const sortedTemplates = [...scheduleTemplates].sort((a, b) => 
    parseInt(a.dayOfWeek) - parseInt(b.dayOfWeek)
  );

  const upcomingAppointments = appointments.filter(
    apt => apt.status !== 'cancelled' && apt.status !== 'completed'
  );

  // Filter appointments based on selected date
  const filteredAppointments = appointments.filter(apt => {
    if (!filterDate) {
      return true; // No filter applied, show all
    }
    
    try {
      const aptDate = startOfDay(parseISO(apt.appointmentDate));
      const selectedDate = startOfDay(filterDate);
      return isSameDay(aptDate, selectedDate);
    } catch {
      return false;
    }
  });

  // Group schedule templates by day - use working schedules in edit mode
  const activeSchedules = isEditMode ? workingSchedules : scheduleTemplates;
  const schedulesByDay = DAYS_OF_WEEK.reduce((acc, day) => {
    acc[day.value] = activeSchedules.filter(t => t.dayOfWeek === day.value && !pendingChanges.deletions.has(t.id));
    return acc;
  }, {} as Record<string, ScheduleTemplate[]>);

  // Filter slot overrides based on selected date
  const filteredSlotOverrides = selectedDate 
    ? slotOverrides.filter(override => {
        try {
          const overrideDate = parseISO(override.slotDate);
          return isSameDay(overrideDate, selectedDate);
        } catch {
          return false;
        }
      })
    : slotOverrides.filter(override => {
        try {
          const overrideDate = parseISO(override.slotDate);
          const today = startOfDay(new Date());
          return overrideDate >= today;
        } catch {
          return false;
        }
      });

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", icon: any }> = {
      pending: { variant: "outline", icon: Clock },
      confirmed: { variant: "default", icon: CheckCircle2 },
      cancelled: { variant: "destructive", icon: XCircle },
      completed: { variant: "secondary", icon: CheckCircle2 },
      no_show: { variant: "outline", icon: XCircle },
    };
    
    const config = statusConfig[status] || { variant: "outline", icon: CalendarIcon };
    const Icon = config.icon;
    
    return (
      <Badge variant={config.variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {status.replace('_', ' ')}
      </Badge>
    );
  };

  const handleEditOverride = (override: SlotOverride) => {
    // Calculate end time from start time + duration
    const [hours, minutes] = override.slotTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + parseInt(override.durationMinutes);
    const endHours = Math.floor(totalMinutes / 60) % 24;
    const endMinutes = totalMinutes % 60;
    const endTime = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
    
    setNewOverride({
      slotDate: format(parseISO(override.slotDate), "yyyy-MM-dd"),
      slotTime: override.slotTime,
      endTime: endTime,
      isAvailable: override.isAvailable,
      isAllDay: override.isAllDay,
      reason: override.reason || "",
    });
    setEditingOverride(override);
    setSelectedDate(parseISO(override.slotDate));
    setShowForm(true);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Hero Header with Gradient */}
      <div className="mb-4">
        <div className="bg-gradient-to-br from-[#0B0F1A] via-[#1e3a8a] to-[#7c3aed] rounded-xl p-4 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-white rounded-lg shadow-md">
                <CalendarIcon className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white drop-shadow-md">
                  Appointment Calendar
                </h1>
                <p className="text-white/80 text-sm font-medium">
                  Manage your availability schedule and view upcoming appointments
                </p>
              </div>
            </div>
            
            {/* Master Toggle for Appointment Booking */}
            <div className="flex items-center gap-2.5 bg-white/95 backdrop-blur-md rounded-lg px-3 py-2 border border-white shadow-lg">
              <div className="flex items-center gap-1.5">
                <Power className="w-4 h-4 text-indigo-600" />
                <p className="font-semibold text-xs text-gray-800">Booking</p>
              </div>
              <Switch
                checked={widgetSettings?.appointmentBookingEnabled === 'true'}
                onCheckedChange={(checked) => toggleAppointmentBookingMutation.mutate(checked)}
                disabled={toggleAppointmentBookingMutation.isPending}
              />
            </div>
          </div>
          
          {/* KPI Metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/95 backdrop-blur-lg rounded-lg p-3 border border-white shadow-lg">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-lg shadow-md">
                  <CalendarIcon className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wide">Active Schedules</p>
                  <p className="text-2xl font-extrabold text-gray-900">{scheduleTemplates.length}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-white/95 backdrop-blur-lg rounded-lg p-3 border border-white shadow-lg">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg shadow-md">
                  <TrendingUp className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wide">Upcoming</p>
                  <p className="text-2xl font-extrabold text-gray-900">{upcomingAppointments.length}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-white/95 backdrop-blur-lg rounded-lg p-3 border border-white shadow-lg">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg shadow-md">
                  <Shield className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wide">Total Bookings</p>
                  <p className="text-2xl font-extrabold text-gray-900">{appointments.length}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 bg-gradient-to-r from-purple-50 to-white backdrop-blur-sm shadow-md h-auto p-1 rounded-xl">
          <TabsTrigger value="schedule" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
            <Clock className="w-4 h-4 mr-2" />
            Weekly Schedule
            {scheduleTemplates.length > 0 && (
              <Badge variant="secondary" className="ml-2">{scheduleTemplates.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="overrides" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
            <XCircle className="w-4 h-4 mr-2" />
            Slot Overrides
          </TabsTrigger>
          <TabsTrigger value="appointments" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
            <User className="w-4 h-4 mr-2" />
            Appointments
            {appointments.length > 0 && (
              <Badge variant="secondary" className="ml-2">{appointments.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="triggers" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
            <Zap className="w-4 h-4 mr-2" />
            Triggers
            {triggerRules.filter(r => r.enabled).length > 0 && (
              <Badge variant="secondary" className="ml-2">{triggerRules.filter(r => r.enabled).length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Weekly Schedule Tab - Google Business Hours Style */}
        <TabsContent value="schedule" className="mt-6">
          <Card className="border-slate-200 shadow-lg">
            <CardHeader className="border-b bg-slate-50 dark:bg-slate-900">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Clock className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                    Weekly Business Hours
                  </CardTitle>
                  <CardDescription className="mt-1">Set your availability for each day of the week</CardDescription>
                </div>
                
                {/* Action Buttons */}
                <div className="flex gap-2">
                  {!isEditMode ? (
                    <Button
                      onClick={enterEditMode}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Update Schedule
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={handleSaveChanges}
                        disabled={isSaving}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        {isSaving ? "Saving..." : "Save Changes"}
                      </Button>
                      <Button
                        onClick={handleCancelChanges}
                        disabled={isSaving}
                        variant="outline"
                      >
                        <X className="h-4 w-4 mr-2" />
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {loadingTemplates ? (
                <div className="text-center py-8 text-muted-foreground">Loading schedules...</div>
              ) : (
                <div className="space-y-1">
                  {DAYS_OF_WEEK.map((day) => {
                    const daySchedules = schedulesByDay[day.value] || [];
                    const isClosed = daySchedules.length === 0;
                    
                    // In edit mode, checkbox state is ONLY controlled by pendingChanges.closedDays
                    // In view mode, checkbox state is controlled by whether there are schedules
                    const isClosedCheckboxChecked = isEditMode 
                      ? pendingChanges.closedDays.has(day.value)
                      : isClosed;

                    return (
                      <div
                        key={day.value}
                        className="py-4 border-b last:border-b-0"
                      >
                        <div className="flex items-start gap-4">
                          {/* Day Name - Fixed Width */}
                          <div className="w-28 flex-shrink-0 pt-2">
                            <p className="font-medium text-sm">{day.label}</p>
                          </div>

                          {/* Content Area */}
                          <div className="flex-1 space-y-3">
                            {/* VIEW MODE - Clean display */}
                            {!isEditMode && (
                              <>
                                {isClosed ? (
                                  <p className="text-sm text-muted-foreground pt-2">Closed</p>
                                ) : (
                                  <div className="space-y-2">
                                    {daySchedules.map((schedule) => (
                                      <div key={schedule.id} className="flex items-center gap-2 text-sm">
                                        <Clock className="h-4 w-4 text-blue-600" />
                                        <span className="font-medium">
                                          {schedule.startTime} - {schedule.endTime}
                                        </span>
                                        <span className="text-muted-foreground">
                                          ({schedule.slotDurationMinutes} min slots)
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}

                            {/* EDIT MODE - Interactive controls */}
                            {isEditMode && (
                              <>
                                {/* Closed Checkbox */}
                                <div className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`closed-${day.value}`}
                                    checked={isClosedCheckboxChecked}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        // Mark day as closed
                                        setPendingChanges(prev => ({
                                          ...prev,
                                          closedDays: new Set([...Array.from(prev.closedDays), day.value]),
                                        }));
                                        
                                        // Mark all existing schedules for deletion
                                        const schedulesToDelete = daySchedules.filter(s => !s.id.startsWith('temp-'));
                                        setPendingChanges(prev => ({
                                          ...prev,
                                          deletions: new Set([...Array.from(prev.deletions), ...schedulesToDelete.map(s => s.id)]),
                                        }));
                                        
                                        // Remove pending additions for this day
                                        setPendingChanges(prev => ({
                                          ...prev,
                                          additions: prev.additions.filter(a => a.dayOfWeek !== day.value),
                                        }));
                                      } else {
                                        // Unmark day as closed
                                        const newClosedDays = new Set(pendingChanges.closedDays);
                                        newClosedDays.delete(day.value);
                                        
                                        // Remove this day's schedule IDs from deletions
                                        // Use scheduleTemplates (authoritative backend data) to get all schedule IDs for this day
                                        const dayScheduleIds = scheduleTemplates
                                          .filter(s => s.dayOfWeek === day.value)
                                          .map(s => s.id);
                                        const newDeletions = new Set(Array.from(pendingChanges.deletions).filter(
                                          id => !dayScheduleIds.includes(id)
                                        ));
                                        
                                        setPendingChanges(prev => ({
                                          ...prev,
                                          closedDays: newClosedDays,
                                          deletions: newDeletions,
                                        }));
                                      }
                                    }}
                                  />
                                  <label
                                    htmlFor={`closed-${day.value}`}
                                    className="text-sm font-medium select-none cursor-pointer"
                                  >
                                    Closed
                                  </label>
                                </div>

                                {/* Time Ranges - Only show if not closed */}
                                {!isClosedCheckboxChecked && (
                              <div className="space-y-3">
                                {/* Existing and Pending Addition Time Ranges */}
                                {daySchedules.map((schedule) => {
                                  // Get current values (check if there's a pending update)
                                  const currentData = pendingChanges.updates.has(schedule.id)
                                    ? pendingChanges.updates.get(schedule.id)!
                                    : {
                                        startTime: schedule.startTime,
                                        endTime: schedule.endTime,
                                        slotDurationMinutes: schedule.slotDurationMinutes,
                                      };
                                  
                                  return (
                                    <div
                                      key={schedule.id}
                                      className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border"
                                    >
                                      <div className="flex items-center gap-2 flex-1">
                                        <Input
                                          type="time"
                                          value={currentData.startTime}
                                          disabled={!isEditMode}
                                          onChange={(e) => {
                                            if (!isEditMode) return;
                                            const newUpdates = new Map(pendingChanges.updates);
                                            newUpdates.set(schedule.id, {
                                              ...currentData,
                                              startTime: e.target.value,
                                            });
                                            setPendingChanges(prev => ({ ...prev, updates: newUpdates }));
                                          }}
                                          className="w-32 bg-white dark:bg-slate-800"
                                        />
                                        <span className="text-sm text-muted-foreground">-</span>
                                        <Input
                                          type="time"
                                          value={currentData.endTime}
                                          disabled={!isEditMode}
                                          onChange={(e) => {
                                            if (!isEditMode) return;
                                            const newUpdates = new Map(pendingChanges.updates);
                                            newUpdates.set(schedule.id, {
                                              ...currentData,
                                              endTime: e.target.value,
                                            });
                                            setPendingChanges(prev => ({ ...prev, updates: newUpdates }));
                                          }}
                                          className="w-32 bg-white dark:bg-slate-800"
                                        />
                                        
                                        {/* Slot Duration - Show as text in view mode, select in edit mode */}
                                        {!isEditMode ? (
                                          <div className="flex items-center gap-2 ml-3">
                                            <Clock className="h-3 w-3 text-muted-foreground" />
                                            <span className="text-xs text-muted-foreground">
                                              {currentData.slotDurationMinutes} min slots
                                            </span>
                                          </div>
                                        ) : (
                                          <div className="ml-2">
                                            <Select
                                              value={currentData.slotDurationMinutes}
                                              onValueChange={(value) => {
                                                const newUpdates = new Map(pendingChanges.updates);
                                                newUpdates.set(schedule.id, {
                                                  ...currentData,
                                                  slotDurationMinutes: value,
                                                });
                                                setPendingChanges(prev => ({ ...prev, updates: newUpdates }));
                                              }}
                                            >
                                              <SelectTrigger className="w-32">
                                                <SelectValue />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="15">15 min</SelectItem>
                                                <SelectItem value="30">30 min</SelectItem>
                                                <SelectItem value="45">45 min</SelectItem>
                                                <SelectItem value="60">60 min</SelectItem>
                                              </SelectContent>
                                            </Select>
                                          </div>
                                        )}
                                      </div>
                                      
                                      {/* Delete Button - Only show in edit mode */}
                                      {isEditMode && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            if (schedule.id.startsWith('temp-')) {
                                              // Remove from pending additions
                                              setPendingChanges(prev => ({
                                                ...prev,
                                                additions: prev.additions.filter(a => a.tempId !== schedule.id),
                                              }));
                                              setWorkingSchedules(prev => prev.filter(s => s.id !== schedule.id));
                                            } else {
                                              // Mark for deletion
                                              const newDeletions = new Set(pendingChanges.deletions);
                                              newDeletions.add(schedule.id);
                                              setPendingChanges(prev => ({ ...prev, deletions: newDeletions }));
                                            }
                                          }}
                                          className="hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      )}
                                    </div>
                                  );
                                })}
                                
                                {/* Pending Additions */}
                                {pendingChanges.additions
                                  .filter(add => add.dayOfWeek === day.value)
                                  .map((addition) => (
                                    <div
                                      key={addition.tempId}
                                      className="flex items-center gap-3 bg-blue-50 dark:bg-blue-950 p-3 rounded-lg border border-blue-200"
                                    >
                                      <div className="flex items-center gap-2 flex-1">
                                        <Input
                                          type="time"
                                          value={addition.startTime}
                                          onChange={(e) => {
                                            setPendingChanges(prev => ({
                                              ...prev,
                                              additions: prev.additions.map(a =>
                                                a.tempId === addition.tempId
                                                  ? { ...a, startTime: e.target.value }
                                                  : a
                                              ),
                                            }));
                                          }}
                                          className="w-32"
                                        />
                                        <span className="text-sm text-muted-foreground">-</span>
                                        <Input
                                          type="time"
                                          value={addition.endTime}
                                          onChange={(e) => {
                                            setPendingChanges(prev => ({
                                              ...prev,
                                              additions: prev.additions.map(a =>
                                                a.tempId === addition.tempId
                                                  ? { ...a, endTime: e.target.value }
                                                  : a
                                              ),
                                            }));
                                          }}
                                          className="w-32"
                                        />
                                        <div className="ml-2">
                                          <Select
                                            value={addition.slotDurationMinutes}
                                            onValueChange={(value) => {
                                              setPendingChanges(prev => ({
                                                ...prev,
                                                additions: prev.additions.map(a =>
                                                  a.tempId === addition.tempId
                                                    ? { ...a, slotDurationMinutes: value }
                                                    : a
                                                ),
                                              }));
                                            }}
                                          >
                                            <SelectTrigger className="w-32">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="15">15 min</SelectItem>
                                              <SelectItem value="30">30 min</SelectItem>
                                              <SelectItem value="45">45 min</SelectItem>
                                              <SelectItem value="60">60 min</SelectItem>
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          setPendingChanges(prev => ({
                                            ...prev,
                                            additions: prev.additions.filter(a => a.tempId !== addition.tempId),
                                          }));
                                        }}
                                        className="hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  ))}

                                {/* Add Hours Button - Only show in edit mode */}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const tempId = `temp-${Date.now()}-${Math.random()}`;
                                    setPendingChanges(prev => ({
                                      ...prev,
                                      additions: [
                                        ...prev.additions,
                                        {
                                          dayOfWeek: day.value,
                                          startTime: "09:00",
                                          endTime: "17:00",
                                          slotDurationMinutes: "30",
                                          tempId,
                                        },
                                      ],
                                    }));
                                  }}
                                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950 border-dashed"
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Add hours
                                </Button>
                              </div>
                            )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Slot Overrides Tab */}
        <TabsContent value="overrides" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-[40%_1fr] gap-6">
            {/* Left Column - Legend and Calendar */}
            <div className="space-y-3">
              {/* Compact Legend */}
              <Card className="border-purple-100 shadow-sm">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Legend</p>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-4 rounded-sm bg-red-400"></div>
                      <span className="text-muted-foreground">All-day</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-4 h-4 rounded-sm bg-gradient-to-r from-cyan-400 to-teal-500"></div>
                      <span className="text-muted-foreground">Time-specific</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Full-height Calendar */}
              <Card className="border-purple-100 shadow-lg">
                <CardContent className="pt-4 pb-4">
                  <CalendarComponent
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    className="rounded-md border w-full"
                    modifiers={{
                      hasAllDayBlock: (date) => dateHasAllDayBlock(date),
                      hasTimeBlock: (date) => dateHasTimeSpecificBlock(date) && !dateHasAllDayBlock(date),
                    }}
                    modifiersClassNames={{
                      hasAllDayBlock: "bg-red-400 text-white hover:bg-red-500 font-bold",
                      hasTimeBlock: "bg-gradient-to-r from-cyan-400 to-teal-500 text-white hover:from-cyan-500 hover:to-teal-600 font-bold",
                    }}
                  />
                  {selectedDate && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">
                          Selected: {format(selectedDate, "MMM dd, yyyy")}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedDate(undefined);
                            setShowForm(false);
                            setEditingOverride(null);
                          }}
                          className="h-7 text-xs"
                        >
                          <X className="h-3 w-3 mr-1" />
                          Clear
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {filteredSlotOverrides.length} block{filteredSlotOverrides.length !== 1 ? 's' : ''} on this date
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Dynamic Panel */}
            <div className="space-y-6">
              {/* Dynamic Panel: Empty State or Form */}
              {!showForm ? (
                <Card className="border-purple-100 shadow-lg">
                  <CardContent className="pt-16 pb-16 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="p-4 bg-red-100 dark:bg-red-900 rounded-full">
                        <CalendarIcon className="h-10 w-10 text-red-500 dark:text-red-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold mb-2">Select a Date to Block</h3>
                        <p className="text-muted-foreground">
                          Click any date on the calendar to create a new block
                        </p>
                      </div>
                      {slotOverrides.length > 0 && (
                        <div className="mt-4 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg">
                          <p className="text-sm text-muted-foreground">
                            Total blocked slots: <span className="font-semibold text-foreground">{slotOverrides.length}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-amber-100 shadow-lg">
                  <CardHeader className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950 dark:to-orange-950 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <div className="p-1.5 bg-amber-100 dark:bg-amber-900 rounded-lg">
                            <XCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          </div>
                          Block Time Slot
                        </CardTitle>
                        {selectedDate && (
                          <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mt-2">
                            Blocking: {format(selectedDate, "EEE, dd MMM yyyy")}
                          </p>
                        )}
                      </div>
                      {editingOverride && (
                        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200">
                          Editing
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div className="flex items-center space-x-2 p-3 bg-amber-50 dark:bg-amber-950 rounded-lg border border-amber-200 dark:border-amber-800">
                        <Checkbox
                          id="all-day-block"
                          checked={newOverride.isAllDay === "true"}
                          onCheckedChange={(checked) => 
                            setNewOverride({ ...newOverride, isAllDay: checked ? "true" : "false" })
                          }
                        />
                        <label
                          htmlFor="all-day-block"
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                        >
                          <CalendarIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          All Day - Block entire day (holidays, vacation, etc.)
                        </label>
                      </div>

                      {newOverride.isAllDay === "false" && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-sm font-medium">Start Time</Label>
                            <Input
                              type="time"
                              value={newOverride.slotTime}
                              onChange={(e) => {
                                setNewOverride({ ...newOverride, slotTime: e.target.value });
                                setFormError("");
                              }}
                              className="mt-1.5"
                            />
                          </div>
                          <div>
                            <Label className="text-sm font-medium">End Time</Label>
                            <Input
                              type="time"
                              value={newOverride.endTime}
                              onChange={(e) => {
                                setNewOverride({ ...newOverride, endTime: e.target.value });
                                setFormError("");
                              }}
                              className="mt-1.5"
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <Label className="text-sm font-medium">Reason</Label>
                        <Input
                          placeholder={newOverride.isAllDay === "true" ? "e.g., Christmas Holiday, Vacation" : "e.g., Lunch break, Meeting"}
                          value={newOverride.reason}
                          onChange={(e) => setNewOverride({ ...newOverride, reason: e.target.value })}
                          className="mt-1.5"
                        />
                      </div>

                      {formError && (
                        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
                          <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                            <AlertCircle className="h-4 w-4" />
                            {formError}
                          </p>
                        </div>
                      )}

                      <Button
                        onClick={() => {
                          setFormError("");
                          
                          if (newOverride.isAllDay === "false") {
                            if (!newOverride.slotTime || !newOverride.endTime) {
                              setFormError("Please enter both start and end times");
                              return;
                            }
                            
                            const duration = calculateDuration(newOverride.slotTime, newOverride.endTime);
                            if (duration === null || duration <= 0) {
                              setFormError("End time must be after start time");
                              return;
                            }
                          }
                          
                          if (editingOverride) {
                            updateOverrideMutation.mutate({ id: editingOverride.id, override: newOverride });
                          } else {
                            createOverrideMutation.mutate(newOverride);
                          }
                        }}
                        disabled={createOverrideMutation.isPending || updateOverrideMutation.isPending}
                        className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600"
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        {editingOverride 
                          ? (newOverride.isAllDay === "true" ? "Update Day Block" : "Update Slot Block")
                          : (newOverride.isAllDay === "true" ? "Block Entire Day" : "Block Slot")
                        }
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Blocked Slots List - Always visible below */}
              <Card className="shadow-lg border-amber-100">
                <CardHeader className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950 dark:to-orange-950 border-b">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <div className="p-1.5 bg-amber-100 dark:bg-amber-900 rounded-lg">
                          <XCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                        Blocked Time Slots
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {selectedDate 
                          ? `Showing blocks for ${format(selectedDate, "MMM dd, yyyy")}`
                          : "All upcoming blocks"}
                      </CardDescription>
                    </div>
                    {filteredSlotOverrides.length > 0 && (
                      <Badge variant="secondary" className="ml-2">
                        {filteredSlotOverrides.length}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  {loadingOverrides ? (
                    <div className="text-center py-8 text-muted-foreground">Loading blocked slots...</div>
                  ) : filteredSlotOverrides.length === 0 ? (
                    <div className="text-center py-12">
                      <XCircle className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                      <p className="text-muted-foreground">
                        {selectedDate 
                          ? `No blocks on ${format(selectedDate, "MMM dd, yyyy")}`
                          : "No blocked time slots yet"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {selectedDate
                          ? "Select this or another date to create a block"
                          : "Select a date on the calendar to create a block"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                      {[...filteredSlotOverrides]
                        .sort((a, b) => {
                          const dateCompare = new Date(b.slotDate).getTime() - new Date(a.slotDate).getTime();
                          if (dateCompare !== 0) return dateCompare;
                          return b.slotTime.localeCompare(a.slotTime);
                        })
                        .map((override) => {
                          const date = parseISO(override.slotDate);
                          const formattedDate = format(date, "EEE, dd MMM yyyy");
                          const isAllDay = override.isAllDay === "true";
                          
                          return (
                            <div
                              key={override.id}
                              className="group flex items-start justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 hover:border-primary/30 transition-all"
                            >
                              <div className="flex items-start gap-3 flex-1">
                                <div className={`p-2 rounded-lg ${isAllDay ? 'bg-red-100 dark:bg-red-900' : 'bg-gradient-to-r from-cyan-100 to-teal-100 dark:from-cyan-900 dark:to-teal-900'}`}>
                                  {isAllDay ? (
                                    <CalendarIcon className="h-5 w-5 text-red-500 dark:text-red-400" />
                                  ) : (
                                    <Clock className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-semibold text-sm">{formattedDate}</p>
                                    {isAllDay ? (
                                      <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 text-xs">
                                        All Day
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-xs">
                                        {override.slotTime} - {(() => {
                                          const [hours, minutes] = override.slotTime.split(':').map(Number);
                                          const totalMinutes = hours * 60 + minutes + parseInt(override.durationMinutes);
                                          const endHours = Math.floor(totalMinutes / 60) % 24;
                                          const endMinutes = totalMinutes % 60;
                                          return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
                                        })()}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-sm text-muted-foreground mt-1 truncate">
                                    {override.reason || "No reason provided"}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 ml-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditOverride(override)}
                                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950"
                                  title="Edit block"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => deleteOverrideMutation.mutate(override.id)}
                                  disabled={deleteOverrideMutation.isPending}
                                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                                  title="Delete block"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Appointments Tab */}
        <TabsContent value="appointments" className="space-y-6 mt-6">
          <Card className="shadow-lg border-blue-100">
            <CardHeader className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 border-b">
              <CardTitle className="flex items-center gap-2 text-lg">
                <div className="p-1.5 bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                Appointments
              </CardTitle>
              <CardDescription>Manage and track your scheduled appointments</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {/* Date Filter */}
              <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-900 rounded-lg border">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                    <span className="text-sm font-medium">Filter by Date:</span>
                  </div>
                  
                  <Input
                    type="date"
                    value={filterDate ? format(filterDate, 'yyyy-MM-dd') : ''}
                    onChange={(e) => setFilterDate(e.target.value ? new Date(e.target.value) : undefined)}
                    className="w-48"
                  />
                  
                  {filterDate && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFilterDate(undefined)}
                      className="ml-auto"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Clear Filter
                    </Button>
                  )}
                </div>
                
                {filterDate && (
                  <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    Showing {filteredAppointments.length} of {appointments.length} appointments for {format(filterDate, 'MMM dd, yyyy')}
                  </div>
                )}
              </div>

              {loadingAppointments ? (
                <div className="text-center py-8 text-muted-foreground">Loading appointments...</div>
              ) : appointments.length === 0 ? (
                <div className="text-center py-12">
                  <User className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">No appointments scheduled yet</p>
                </div>
              ) : filteredAppointments.length === 0 ? (
                <div className="text-center py-12">
                  <CalendarIcon className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">No appointments found for selected dates</p>
                  <Button
                    variant="ghost"
                    onClick={() => setFilterDate(undefined)}
                    className="mt-2"
                  >
                    Clear filter to see all appointments
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50 dark:bg-slate-900">
                        <TableHead className="font-semibold">Patient</TableHead>
                        <TableHead className="font-semibold">Date & Time</TableHead>
                        <TableHead className="font-semibold">Contact</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAppointments.map((apt) => (
                        <TableRow key={apt.id} className="hover:bg-slate-50 dark:hover:bg-slate-900">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                                <User className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                              </div>
                              <span className="font-medium">{apt.patientName}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{format(new Date(apt.appointmentDate), 'MMM dd, yyyy')}</span>
                              <span className="text-sm text-muted-foreground">{apt.appointmentTime}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div>{apt.patientPhone}</div>
                              {apt.patientEmail && (
                                <div className="text-muted-foreground">{apt.patientEmail}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{getStatusBadge(apt.status)}</TableCell>
                          <TableCell>
                            <Select
                              value={apt.status}
                              onValueChange={(value) => updateAppointmentStatusMutation.mutate({ id: apt.id, status: value })}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="confirmed">Confirmed</SelectItem>
                                <SelectItem value="completed">Completed</SelectItem>
                                <SelectItem value="cancelled">Cancelled</SelectItem>
                                <SelectItem value="no_show">No Show</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Triggers Tab */}
        <TabsContent value="triggers" className="space-y-6 mt-6">
          <Card className="shadow-lg border-amber-100">
            <CardHeader className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950 dark:to-orange-950 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <div className="p-1.5 bg-amber-100 dark:bg-amber-900 rounded-lg">
                      <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    Appointment Triggers
                  </CardTitle>
                  <CardDescription>Configure when the AI should suggest booking an appointment</CardDescription>
                </div>
                <Button
                  onClick={() => {
                    setEditingTrigger(null);
                    setNewTrigger({ keywords: "", prompt: "Would you like me to schedule an appointment for you?" });
                    setShowTriggerModal(true);
                  }}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Trigger
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {triggerRules.length === 0 ? (
                <div className="text-center py-12">
                  <Zap className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground mb-2">No trigger rules configured</p>
                  <p className="text-sm text-muted-foreground">Add keywords that will prompt the AI to suggest booking an appointment</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {triggerRules.map((rule) => (
                    <div
                      key={rule.id}
                      className={`p-4 rounded-lg border ${rule.enabled ? 'bg-white border-amber-200' : 'bg-slate-50 border-slate-200 opacity-60'}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-medium text-slate-600">Keywords:</span>
                            <div className="flex flex-wrap gap-1">
                              {rule.keywords.map((keyword, idx) => (
                                <Badge key={idx} variant="secondary" className="bg-amber-100 text-amber-800">
                                  {keyword}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="text-sm">
                            <span className="font-medium text-slate-600">Prompt: </span>
                            <span className="text-slate-700 italic">"{rule.prompt}"</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={rule.enabled}
                            onCheckedChange={(checked) => toggleTriggerRule(rule.id, checked)}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingTrigger(rule);
                              setNewTrigger({
                                keywords: rule.keywords.join(", "),
                                prompt: rule.prompt,
                              });
                              setShowTriggerModal(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteTriggerRule(rule.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add/Edit Trigger Modal */}
              {showTriggerModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">
                        {editingTrigger ? "Edit Trigger" : "Add New Trigger"}
                      </h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowTriggerModal(false)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="keywords">Keywords (comma-separated)</Label>
                        <Input
                          id="keywords"
                          placeholder="interested, pricing, visit, demo"
                          value={newTrigger.keywords}
                          onChange={(e) => setNewTrigger({ ...newTrigger, keywords: e.target.value })}
                          className="mt-1"
                        />
                        <p className="text-sm text-muted-foreground mt-1">
                          When a user's message contains any of these keywords, the AI will use the prompt below
                        </p>
                      </div>
                      
                      <div>
                        <Label htmlFor="prompt">Custom Prompt</Label>
                        <Input
                          id="prompt"
                          placeholder="Would you like me to schedule an appointment for you?"
                          value={newTrigger.prompt}
                          onChange={(e) => setNewTrigger({ ...newTrigger, prompt: e.target.value })}
                          className="mt-1"
                        />
                        <p className="text-sm text-muted-foreground mt-1">
                          The AI will use this message to suggest booking an appointment
                        </p>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 mt-6">
                      <Button
                        variant="outline"
                        onClick={() => setShowTriggerModal(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={saveTriggerRule}
                        className="bg-amber-600 hover:bg-amber-700"
                      >
                        {editingTrigger ? "Save Changes" : "Add Trigger"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
