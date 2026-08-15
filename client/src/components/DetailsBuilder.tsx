import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, GripVertical, Download, Phone, ExternalLink, FileText, MessageSquare } from "lucide-react";

export interface DetailsTab {
  id: string;
  name: string;
  content: string;
}

export interface DetailsActionButton {
  id: string;
  type: "call" | "url" | "chat" | "form";
  label: string;
  value: string;
  isPrimary: boolean;
}

export interface DetailsConfig {
  brochureUrl?: string;
  brochureLabel?: string;
  tabs: DetailsTab[];
  actionButtons: DetailsActionButton[];
}

interface DetailsBuilderProps {
  value: DetailsConfig;
  onChange: (config: DetailsConfig) => void;
}

const generateId = () => Math.random().toString(36).substr(2, 9);

const buttonTypeOptions = [
  { value: "call", label: "Call Phone", icon: Phone },
  { value: "url", label: "Open URL", icon: ExternalLink },
  { value: "chat", label: "Start Chat", icon: MessageSquare },
  { value: "form", label: "Open Form", icon: FileText },
];

export function DetailsBuilder({ value, onChange }: DetailsBuilderProps) {
  const [activeTabId, setActiveTabId] = useState<string | null>(
    value.tabs.length > 0 ? value.tabs[0].id : null
  );

  const addTab = () => {
    const newTab: DetailsTab = {
      id: generateId(),
      name: `Tab ${value.tabs.length + 1}`,
      content: "",
    };
    const newTabs = [...value.tabs, newTab];
    onChange({ ...value, tabs: newTabs });
    setActiveTabId(newTab.id);
  };

  const updateTab = (id: string, updates: Partial<DetailsTab>) => {
    const newTabs = value.tabs.map((tab) =>
      tab.id === id ? { ...tab, ...updates } : tab
    );
    onChange({ ...value, tabs: newTabs });
  };

  const removeTab = (id: string) => {
    const newTabs = value.tabs.filter((tab) => tab.id !== id);
    onChange({ ...value, tabs: newTabs });
    if (activeTabId === id) {
      setActiveTabId(newTabs.length > 0 ? newTabs[0].id : null);
    }
  };

  const addActionButton = () => {
    const newButton: DetailsActionButton = {
      id: generateId(),
      type: "url",
      label: "Button",
      value: "",
      isPrimary: value.actionButtons.length === 0,
    };
    onChange({ ...value, actionButtons: [...value.actionButtons, newButton] });
  };

  const updateActionButton = (id: string, updates: Partial<DetailsActionButton>) => {
    const newButtons = value.actionButtons.map((btn) =>
      btn.id === id ? { ...btn, ...updates } : btn
    );
    onChange({ ...value, actionButtons: newButtons });
  };

  const removeActionButton = (id: string) => {
    const newButtons = value.actionButtons.filter((btn) => btn.id !== id);
    onChange({ ...value, actionButtons: newButtons });
  };

  const activeTab = value.tabs.find((tab) => tab.id === activeTabId);

  return (
    <div className="space-y-6">
      {/* Brochure Section */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Download Link (Optional)</Label>
        <div className="grid grid-cols-2 gap-3">
          <Input
            placeholder="Link label (e.g., Download Brochure)"
            value={value.brochureLabel || ""}
            onChange={(e) => onChange({ ...value, brochureLabel: e.target.value })}
          />
          <Input
            placeholder="URL"
            value={value.brochureUrl || ""}
            onChange={(e) => onChange({ ...value, brochureUrl: e.target.value })}
          />
        </div>
      </div>

      {/* Tabs Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Content Tabs</Label>
          <Button variant="outline" size="sm" onClick={addTab}>
            <Plus className="w-4 h-4 mr-1" />
            Add Tab
          </Button>
        </div>

        {value.tabs.length > 0 && (
          <div className="border rounded-lg">
            {/* Tab Headers */}
            <div className="flex border-b overflow-x-auto">
              {value.tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`flex items-center gap-2 px-3 py-2 border-r cursor-pointer min-w-fit ${
                    activeTabId === tab.id
                      ? "bg-primary/10 border-b-2 border-b-primary"
                      : "hover:bg-muted"
                  }`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <Input
                    value={tab.name}
                    onChange={(e) => {
                      e.stopPropagation();
                      updateTab(tab.id, { name: e.target.value });
                    }}
                    className="h-7 w-24 text-xs border-0 bg-transparent p-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTab(tab.id);
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Tab Content Editor */}
            {activeTab && (
              <div className="p-4">
                <Textarea
                  placeholder="Enter tab content here. You can use markdown-style formatting:&#10;&#10;**Bold text**&#10;• Bullet point&#10;Duration: 3 Years"
                  value={activeTab.content}
                  onChange={(e) => updateTab(activeTab.id, { content: e.target.value })}
                  rows={8}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Use **text** for bold, • for bullets, and empty lines for paragraphs.
                </p>
              </div>
            )}
          </div>
        )}

        {value.tabs.length === 0 && (
          <div className="border rounded-lg p-6 text-center text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No tabs yet. Add a tab to create content sections.</p>
          </div>
        )}
      </div>

      {/* Action Buttons Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Action Buttons</Label>
          <Button variant="outline" size="sm" onClick={addActionButton}>
            <Plus className="w-4 h-4 mr-1" />
            Add Button
          </Button>
        </div>

        <div className="space-y-2">
          {value.actionButtons.map((btn) => (
            <Card key={btn.id}>
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                  
                  <Select
                    value={btn.type}
                    onValueChange={(val) => updateActionButton(btn.id, { type: val as any })}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {buttonTypeOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    placeholder="Label"
                    value={btn.label}
                    onChange={(e) => updateActionButton(btn.id, { label: e.target.value })}
                    className="flex-1"
                  />

                  {btn.type !== "chat" && (
                    <Input
                      placeholder={
                        btn.type === "call" ? "+1234567890" :
                        btn.type === "url" ? "https://..." :
                        "Form/Journey ID"
                      }
                      value={btn.value}
                      onChange={(e) => updateActionButton(btn.id, { value: e.target.value })}
                      className="flex-1"
                    />
                  )}

                  <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={btn.isPrimary}
                      onChange={(e) => updateActionButton(btn.id, { isPrimary: e.target.checked })}
                      className="w-3 h-3"
                    />
                    Primary
                  </label>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeActionButton(btn.id)}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {value.actionButtons.length === 0 && (
            <div className="border rounded-lg p-4 text-center text-muted-foreground">
              <p className="text-sm">No action buttons. Add buttons to appear at the bottom.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function parseDetailsConfig(actionValue: string | null | undefined): DetailsConfig {
  if (!actionValue) {
    return { tabs: [], actionButtons: [] };
  }
  try {
    return JSON.parse(actionValue);
  } catch {
    return { tabs: [], actionButtons: [] };
  }
}

export function stringifyDetailsConfig(config: DetailsConfig): string {
  return JSON.stringify(config);
}
