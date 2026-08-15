import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function useAutonomousSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [autoResolutionEnabled, setAutoResolutionEnabled] = useState(true);
  const [autoResolutionConfidence, setAutoResolutionConfidence] = useState(75);
  const [escalationSensitivity, setEscalationSensitivity] = useState("medium");
  const [humanOnlyCategories, setHumanOnlyCategories] = useState("");

  const { data: autonomousSettings, isLoading } = useQuery({
    queryKey: ["autonomous-settings"],
    queryFn: async () => {
      const response = await fetch("/api/settings/autonomous", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch settings");
      return response.json();
    },
  });

  useEffect(() => {
    if (autonomousSettings) {
      setAutoResolutionEnabled(autonomousSettings.autoResolutionEnabled === "true");
      setAutoResolutionConfidence(Number(autonomousSettings.autoResolutionConfidence) || 75);
      setEscalationSensitivity(autonomousSettings.escalationSensitivity || "medium");
      setHumanOnlyCategories(autonomousSettings.humanOnlyCategories || "");
    }
  }, [autonomousSettings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch("/api/settings/autonomous", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update settings");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autonomous-settings"] });
      toast({
        title: "Success",
        description: "Autonomous support settings updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update settings",
        variant: "destructive",
      });
    },
  });

  const saveSettings = () => {
    updateSettingsMutation.mutate({
      autoResolutionEnabled: autoResolutionEnabled ? "true" : "false",
      autoResolutionConfidence: autoResolutionConfidence.toString(),
      escalationSensitivity,
      humanOnlyCategories,
    });
  };

  return {
    autoResolutionEnabled,
    setAutoResolutionEnabled,
    autoResolutionConfidence,
    setAutoResolutionConfidence,
    escalationSensitivity,
    setEscalationSensitivity,
    humanOnlyCategories,
    setHumanOnlyCategories,
    saveSettings,
    isLoading,
    isSaving: updateSettingsMutation.isPending,
  };
}
