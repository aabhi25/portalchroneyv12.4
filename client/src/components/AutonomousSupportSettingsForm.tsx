import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Bot, Zap } from "lucide-react";

interface AutonomousSupportSettingsFormProps {
  autoResolutionEnabled: boolean;
  setAutoResolutionEnabled: (value: boolean) => void;
  autoResolutionConfidence: number;
  setAutoResolutionConfidence: (value: number) => void;
  escalationSensitivity: string;
  setEscalationSensitivity: (value: string) => void;
  humanOnlyCategories: string;
  setHumanOnlyCategories: (value: string) => void;
  onSave: () => void;
  isSaving: boolean;
}

export default function AutonomousSupportSettingsForm({
  autoResolutionEnabled,
  setAutoResolutionEnabled,
  autoResolutionConfidence,
  setAutoResolutionConfidence,
  escalationSensitivity,
  setEscalationSensitivity,
  humanOnlyCategories,
  setHumanOnlyCategories,
  onSave,
  isSaving,
}: AutonomousSupportSettingsFormProps) {
  return (
    <div className="space-y-6">
      {/* Enable Auto-Resolution */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Enable Auto-Resolution</Label>
          <p className="text-xs text-muted-foreground">
            Allow AI to automatically resolve tickets without human intervention
          </p>
        </div>
        <Switch
          checked={autoResolutionEnabled}
          onCheckedChange={setAutoResolutionEnabled}
        />
      </div>

      {/* Confidence Threshold */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">
          Auto-Resolution Confidence Threshold: {autoResolutionConfidence}%
        </Label>
        <p className="text-xs text-muted-foreground">
          AI must be this confident to auto-resolve a ticket (higher = fewer auto-resolutions)
        </p>
        <Slider
          value={[autoResolutionConfidence]}
          onValueChange={(value) => setAutoResolutionConfidence(value[0])}
          min={60}
          max={90}
          step={5}
          className="w-full"
          disabled={!autoResolutionEnabled}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>60% (More automated)</span>
          <span>90% (More cautious)</span>
        </div>
      </div>

      {/* Escalation Sensitivity */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Escalation Sensitivity</Label>
        <p className="text-xs text-muted-foreground">
          How quickly to escalate complex issues to human agents
        </p>
        <Select value={escalationSensitivity} onValueChange={setEscalationSensitivity}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">
              <div className="flex items-center gap-2">
                <Zap className="w-3 h-3 text-green-500" />
                <span>Low - AI tries harder (fewer escalations)</span>
              </div>
            </SelectItem>
            <SelectItem value="medium">
              <div className="flex items-center gap-2">
                <Zap className="w-3 h-3 text-yellow-500" />
                <span>Medium - Balanced approach</span>
              </div>
            </SelectItem>
            <SelectItem value="high">
              <div className="flex items-center gap-2">
                <Zap className="w-3 h-3 text-red-500" />
                <span>High - Quick escalation (more human support)</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Human-Only Categories */}
      <div className="space-y-2">
        <Label htmlFor="humanOnlyCategories" className="text-sm font-medium">
          Human-Only Categories
        </Label>
        <p className="text-xs text-muted-foreground">
          Comma-separated categories that always go to human agents (e.g. "billing, refunds, complaints")
        </p>
        <Input
          id="humanOnlyCategories"
          value={humanOnlyCategories}
          onChange={(e) => setHumanOnlyCategories(e.target.value)}
          placeholder="billing, refunds, complaints"
          className="mt-2"
        />
      </div>

      <Button
        onClick={onSave}
        disabled={isSaving}
        className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
      >
        {isSaving ? (
          <>
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
            Saving...
          </>
        ) : (
          <>
            <Bot className="w-4 h-4 mr-2" />
            Save Autonomous Settings
          </>
        )}
      </Button>
    </div>
  );
}
