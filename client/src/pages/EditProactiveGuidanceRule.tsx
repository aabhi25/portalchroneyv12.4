import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Sparkles, Save, Plus, X, Link2, MessageSquareText, HelpCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ProactiveGuidanceRule {
  id: string;
  businessAccountId: string;
  campaignId: string | null;
  name: string;
  urlPattern: string;
  message: string;
  conversationStarters: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export default function EditProactiveGuidanceRule() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/proactive-guidance/:id");
  const ruleId = params?.id;
  const isNewRule = ruleId === "new";
  
  const campaignIdFromUrl = useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("campaignId");
  }, []);

  const [formData, setFormData] = useState({
    name: "",
    urlPattern: "",
    message: "",
    priority: 0,
    campaignId: campaignIdFromUrl || null as string | null,
  });
  
  interface ConversationStarter {
    question: string;
    answer: string;
  }
  
  const [starters, setStarters] = useState<ConversationStarter[]>([]);
  const [newStarter, setNewStarter] = useState("");
  const [expandedStarter, setExpandedStarter] = useState<number | null>(null);
  const [starterToDelete, setStarterToDelete] = useState<number | null>(null);

  const { data: rule, isLoading } = useQuery<ProactiveGuidanceRule>({
    queryKey: [`/api/proactive-guidance-rules/${ruleId}`],
    enabled: !isNewRule && !!ruleId,
  });

  useEffect(() => {
    if (rule) {
      setFormData({
        name: rule.name,
        urlPattern: rule.urlPattern,
        message: rule.message,
        priority: rule.priority,
        campaignId: rule.campaignId,
      });
      if (rule.conversationStarters) {
        try {
          const parsed = JSON.parse(rule.conversationStarters);
          // Handle backward compatibility - convert old string[] format to new object[] format
          if (Array.isArray(parsed)) {
            if (parsed.length > 0 && typeof parsed[0] === 'string') {
              // Old format: string[]
              setStarters(parsed.map((q: string) => ({ question: q, answer: '' })));
            } else {
              // New format: {question, answer}[]
              setStarters(parsed);
            }
          } else {
            setStarters([]);
          }
        } catch {
          setStarters([]);
        }
      } else {
        setStarters([]);
      }
    }
  }, [rule]);
  
  const getBackUrl = () => {
    if (formData.campaignId) {
      return `/guidance-campaigns/${formData.campaignId}`;
    }
    return "/proactive-guidance";
  };
  
  const addStarter = () => {
    if (newStarter.trim()) {
      setStarters([...starters, { question: newStarter.trim(), answer: '' }]);
      setNewStarter("");
      // Auto-expand the newly added starter so user can add answer
      setExpandedStarter(starters.length);
    }
  };
  
  const removeStarter = (index: number) => {
    setStarters(starters.filter((_, i) => i !== index));
    if (expandedStarter === index) {
      setExpandedStarter(null);
    } else if (expandedStarter !== null && expandedStarter > index) {
      setExpandedStarter(expandedStarter - 1);
    }
  };
  
  const updateStarterAnswer = (index: number, answer: string) => {
    const updated = [...starters];
    updated[index] = { ...updated[index], answer };
    setStarters(updated);
  };
  
  const updateStarterQuestion = (index: number, question: string) => {
    const updated = [...starters];
    updated[index] = { ...updated[index], question };
    setStarters(updated);
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/proactive-guidance-rules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/proactive-guidance-rules"] });
      if (formData.campaignId) {
        queryClient.invalidateQueries({ queryKey: [`/api/guidance-campaigns/${formData.campaignId}`] });
      }
      toast({
        title: "Rule created",
        description: "Proactive guidance rule has been created successfully.",
      });
      navigate(getBackUrl());
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("PUT", `/api/proactive-guidance-rules/${ruleId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/proactive-guidance-rules"] });
      queryClient.invalidateQueries({ queryKey: [`/api/proactive-guidance-rules/${ruleId}`] });
      if (formData.campaignId) {
        queryClient.invalidateQueries({ queryKey: [`/api/guidance-campaigns/${formData.campaignId}`] });
      }
      toast({
        title: "Rule updated",
        description: "Proactive guidance rule has been updated successfully.",
      });
      navigate(getBackUrl());
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dataToSubmit = {
      ...formData,
      conversationStarters: starters.length > 0 ? JSON.stringify(starters) : null,
    };
    if (isNewRule) {
      createMutation.mutate(dataToSubmit as typeof formData);
    } else {
      updateMutation.mutate(dataToSubmit as typeof formData);
    }
  };

  if (!isNewRule && isLoading) {
    return (
      <div className="container mx-auto py-8 space-y-6 max-w-4xl px-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-[500px] w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto py-8 space-y-8 max-w-4xl px-6">
        
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(getBackUrl())}
            className="mt-1 hover:bg-primary/10 rounded-xl"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-orange-500/20">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  {isNewRule ? "Create Guidance Rule" : "Edit Guidance Rule"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Configure contextual messages for specific pages
                </p>
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          
          <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
            <CardContent className="p-6 space-y-6">
              
              <div className="flex items-center gap-2 pb-2">
                <Link2 className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Rule Details</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Rule Name
                  </Label>
                  <Input
                    id="name"
                    placeholder="e.g., Checkout Help"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="h-11 rounded-xl border-muted-foreground/20 focus:border-primary/50 transition-colors"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="urlPattern" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    URL Pattern
                  </Label>
                  <Input
                    id="urlPattern"
                    placeholder="e.g., /checkout, /pricing/*"
                    value={formData.urlPattern}
                    onChange={(e) => setFormData({ ...formData, urlPattern: e.target.value })}
                    required
                    className="h-11 rounded-xl border-muted-foreground/20 focus:border-primary/50 transition-colors font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Use <code className="px-1.5 py-0.5 bg-muted rounded text-[10px]">*</code> as wildcard • <code className="px-1.5 py-0.5 bg-muted rounded text-[10px]">/checkout</code> exact • <code className="px-1.5 py-0.5 bg-muted rounded text-[10px]">/pricing/*</code> starts with
                  </p>
                </div>
              </div>
              
              <div className="pt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="w-4 h-4 text-primary" />
                  <Label htmlFor="message" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Guidance Message
                  </Label>
                </div>
                <Textarea
                  id="message"
                  placeholder="Enter the message that will be shown to visitors on matching pages..."
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  rows={5}
                  required
                  className="rounded-xl border-muted-foreground/20 focus:border-primary/50 transition-colors resize-none"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
            <CardContent className="p-6 space-y-5">
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">Conversation Starters</span>
                </div>
                <Badge variant="secondary" className="text-[10px] font-normal">
                  {starters.length}
                </Badge>
              </div>
              
              <p className="text-xs text-muted-foreground -mt-2">
                Quick questions shown as clickable suggestions when this rule is active
              </p>
              
              {starters.length > 0 && (
                <div className="space-y-2">
                  {starters.map((starter, index) => (
                    <div 
                      key={index} 
                      className="bg-muted/50 hover:bg-muted/80 rounded-xl transition-colors overflow-hidden"
                    >
                      <div 
                        className="group flex items-center gap-3 px-4 py-3 cursor-pointer"
                        onClick={() => setExpandedStarter(expandedStarter === index ? null : index)}
                      >
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-medium shrink-0">
                          {index + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm block truncate">{starter.question}</span>
                          {starter.answer && (
                            <span className="text-[10px] text-muted-foreground">Has answer</span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setStarterToDelete(index);
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      
                      {expandedStarter === index && (
                        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/50">
                          <div className="space-y-1.5">
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Question</Label>
                            <Input
                              value={starter.question}
                              onChange={(e) => updateStarterQuestion(index, e.target.value)}
                              className="h-9 rounded-lg text-sm"
                              placeholder="Enter the question..."
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Answer (for AI context)</Label>
                            <Textarea
                              value={starter.answer}
                              onChange={(e) => updateStarterAnswer(index, e.target.value)}
                              className="rounded-lg text-sm resize-none"
                              placeholder="Enter the answer the AI should use when responding to this question..."
                              rows={3}
                            />
                            <p className="text-[10px] text-muted-foreground">
                              This answer will be used as context by the AI when users ask this or similar questions.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., What documents do I need?"
                  value={newStarter}
                  onChange={(e) => setNewStarter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addStarter();
                    }
                  }}
                  className="h-11 rounded-xl border-muted-foreground/20 focus:border-primary/50 transition-colors"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addStarter}
                  disabled={!newStarter.trim()}
                  className="h-11 px-4 rounded-xl"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between pt-2">
            <Button 
              type="button" 
              variant="ghost" 
              onClick={() => navigate("/proactive-guidance")}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={createMutation.isPending || updateMutation.isPending}
              className="rounded-xl px-6 h-11 shadow-lg shadow-primary/20"
            >
              <Save className="w-4 h-4 mr-2" />
              {isNewRule ? "Create Rule" : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>

      <AlertDialog open={starterToDelete !== null} onOpenChange={(open) => !open && setStarterToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Conversation Starter</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this conversation starter? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (starterToDelete !== null) {
                  removeStarter(starterToDelete);
                  setStarterToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
