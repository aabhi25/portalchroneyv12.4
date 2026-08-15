import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import {
  Tag, Settings, Plus, X, ChevronDown, ChevronRight, ArrowUp, ArrowDown,
  Loader2, ArrowLeft, Sparkles, Wand2, Save,
} from "lucide-react";

interface CategoryItem {
  name: string;
  subcategories: string[];
}

export default function CategorySettings() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editCategories, setEditCategories] = useState<CategoryItem[]>([]);
  const [editAllowOther, setEditAllowOther] = useState(true);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const [newSubcategoryInputs, setNewSubcategoryInputs] = useState<Record<number, string>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const initializedRef = useRef(false);

  const { data: settingsData, isLoading } = useQuery<{ categories: CategoryItem[]; allowOtherCategory: boolean }>({
    queryKey: ["/api/settings/conversation-categories"],
    queryFn: async () => {
      const res = await fetch("/api/settings/conversation-categories", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  useEffect(() => {
    if (settingsData && !initializedRef.current) {
      setEditCategories(settingsData.categories?.map(c => ({ ...c, subcategories: [...c.subcategories] })) || []);
      setEditAllowOther(settingsData.allowOtherCategory ?? true);
      initializedRef.current = true;
    }
  }, [settingsData]);

  const saveMutation = useMutation({
    mutationFn: async (data: { categories: CategoryItem[]; allowOtherCategory: boolean }) => {
      const res = await fetch("/api/settings/conversation-categories", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/conversation-categories"] });
      toast({ title: "Categories saved successfully" });
      setHasChanges(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error saving", description: err.message, variant: "destructive" });
    },
  });

  const autoGenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/conversation-categories/auto-generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to generate");
      }
      return res.json();
    },
    onSuccess: (data: { categories: CategoryItem[] }) => {
      if (data.categories && data.categories.length > 0) {
        setEditCategories(data.categories);
        setExpandedCategories(new Set(data.categories.map((_, i) => i)));
        setHasChanges(true);
        toast({ title: "Categories generated", description: `${data.categories.length} categories suggested by AI. Review and save when ready.` });
      } else {
        toast({ title: "No suggestions", description: "AI could not generate categories. Try adding them manually.", variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Auto-generate failed", description: err.message, variant: "destructive" });
    },
  });

  const markChanged = useCallback(() => setHasChanges(true), []);

  const addCategory = useCallback(() => {
    const name = newCategoryName.trim();
    if (!name) return;
    if (editCategories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: "Duplicate category", description: `"${name}" already exists`, variant: "destructive" });
      return;
    }
    setEditCategories(prev => [...prev, { name, subcategories: [] }]);
    setNewCategoryName("");
    markChanged();
  }, [newCategoryName, editCategories, toast, markChanged]);

  const removeCategory = useCallback((index: number) => {
    setEditCategories(prev => prev.filter((_, i) => i !== index));
    markChanged();
  }, [markChanged]);

  const addSubcategory = useCallback((catIndex: number) => {
    const sub = (newSubcategoryInputs[catIndex] || "").trim();
    if (!sub) return;
    setEditCategories(prev =>
      prev.map((c, i) => i === catIndex ? { ...c, subcategories: [...c.subcategories, sub] } : c)
    );
    setNewSubcategoryInputs(prev => ({ ...prev, [catIndex]: "" }));
    markChanged();
  }, [newSubcategoryInputs, markChanged]);

  const removeSubcategory = useCallback((catIndex: number, subIndex: number) => {
    setEditCategories(prev =>
      prev.map((c, i) => i === catIndex ? { ...c, subcategories: c.subcategories.filter((_, si) => si !== subIndex) } : c)
    );
    markChanged();
  }, [markChanged]);

  const moveCategory = useCallback((index: number, direction: 'up' | 'down') => {
    setEditCategories(prev => {
      const next = [...prev];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
    markChanged();
  }, [markChanged]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
        <div className="flex items-center gap-4">
          <SidebarTrigger className="text-gray-500 hover:text-gray-700" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/insights")}
            className="text-gray-500 hover:text-gray-700 gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Insights
          </Button>
          <div className="flex items-center gap-3 ml-2">
            <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-md">
              <Tag className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Conversation Categories</h1>
              <p className="text-xs text-gray-500">Define custom categories to control how the AI classifies conversations</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Wand2 className="w-5 h-5 text-purple-600" />
                    Auto-Generate Categories
                  </CardTitle>
                  <CardDescription className="text-sm mt-1">
                    Let AI analyze your business website and suggest relevant categories automatically
                  </CardDescription>
                </div>
                <Button
                  onClick={() => autoGenerateMutation.mutate()}
                  disabled={autoGenerateMutation.isPending}
                  className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                >
                  {autoGenerateMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Auto-Generate
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings className="w-5 h-5 text-gray-600" />
                Custom Categories
              </CardTitle>
              <CardDescription className="text-sm">
                When categories are defined, the AI will only use these when classifying conversations. Leave empty for free-form AI categorization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Add a category (e.g. Pricing, Support, Enrollment)"
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }}
                  className="flex-1"
                />
                <Button onClick={addCategory} disabled={!newCategoryName.trim()} className="gap-1.5">
                  <Plus className="w-4 h-4" />
                  Add
                </Button>
              </div>

              {editCategories.length === 0 ? (
                <div className="text-center py-10 text-gray-400 border-2 border-dashed rounded-lg">
                  <Tag className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">No custom categories defined</p>
                  <p className="text-xs mt-1 mb-4">The AI will generate categories freely for each conversation</p>
                  <p className="text-xs text-purple-500">Use "Auto-Generate" above or add categories manually</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {editCategories.map((cat, catIndex) => {
                    const isExpanded = expandedCategories.has(catIndex);
                    return (
                      <div key={catIndex} className="border rounded-lg p-3 bg-white hover:border-purple-200 transition-colors">
                        <div className="flex items-center justify-between">
                          <button
                            className="flex items-center gap-2 text-sm font-medium text-gray-800 hover:text-gray-600"
                            onClick={() => setExpandedCategories(prev => {
                              const next = new Set(prev);
                              if (next.has(catIndex)) next.delete(catIndex); else next.add(catIndex);
                              return next;
                            })}
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-purple-500" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                            <span className="text-base">{cat.name}</span>
                            {cat.subcategories.length > 0 && (
                              <span className="text-xs text-gray-400 font-normal ml-1">
                                ({cat.subcategories.length} subcategories)
                              </span>
                            )}
                          </button>
                          <div className="flex items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => moveCategory(catIndex, 'up')}
                              disabled={catIndex === 0}
                              className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => moveCategory(catIndex, 'down')}
                              disabled={catIndex === editCategories.length - 1}
                              className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeCategory(catIndex)}
                              className="h-7 w-7 p-0 text-gray-400 hover:text-red-500"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="mt-3 ml-6 space-y-2">
                            {cat.subcategories.map((sub, subIndex) => (
                              <div key={subIndex} className="flex items-center gap-2 group">
                                <div className="w-1.5 h-1.5 rounded-full bg-purple-300 flex-shrink-0" />
                                <span className="text-sm text-gray-600 bg-gray-50 px-3 py-1.5 rounded-md flex-1">{sub}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeSubcategory(catIndex, subIndex)}
                                  className="h-6 w-6 p-0 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            ))}
                            <div className="flex items-center gap-2 mt-2">
                              <Input
                                placeholder="Add subcategory..."
                                value={newSubcategoryInputs[catIndex] || ""}
                                onChange={e => setNewSubcategoryInputs(prev => ({ ...prev, [catIndex]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubcategory(catIndex); } }}
                                className="flex-1 h-8 text-sm"
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => addSubcategory(catIndex)}
                                disabled={!(newSubcategoryInputs[catIndex] || "").trim()}
                                className="h-8 px-3 gap-1 text-xs"
                              >
                                <Plus className="w-3 h-3" />
                                Add
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="allow-other" className="text-sm font-medium">Allow "Other" category</Label>
                  <p className="text-xs text-gray-400 mt-0.5">Let the AI use "Other" for conversations that don't fit any defined category</p>
                </div>
                <Switch
                  id="allow-other"
                  checked={editAllowOther}
                  onCheckedChange={(v) => { setEditAllowOther(v); markChanged(); }}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between pt-2 pb-8">
            <Button variant="outline" onClick={() => setLocation("/insights")}>
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              Back to Insights
            </Button>
            <Button
              onClick={() => saveMutation.mutate({ categories: editCategories, allowOtherCategory: editAllowOther })}
              disabled={saveMutation.isPending}
              className="gap-2 px-6"
              size="lg"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Categories
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
