import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Zap, Link2, Loader2, ArrowLeft } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useLocation } from "wouter";

interface SmartReply {
  id: string;
  businessAccountId: string;
  channel: string;
  keywords: string;
  responseText: string;
  responseUrl: string | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SmartRepliesProps {
  channel: "whatsapp" | "instagram" | "website";
  headerContent?: React.ReactNode;
}

export default function SmartReplies({ channel, headerContent }: SmartRepliesProps) {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingReply, setEditingReply] = useState<SmartReply | null>(null);
  const [replyToDelete, setReplyToDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    keywords: "",
    responseText: "",
    responseUrl: "",
    priority: 0,
    isActive: true,
  });

  const channelLabel = channel === "whatsapp" ? "WhatsApp" : channel === "instagram" ? "Instagram" : "Website";
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<{ smartReplies: SmartReply[] }>({
    queryKey: [`/api/smart-replies/${channel}`],
  });

  const replies = data?.smartReplies ?? [];

  const createMutation = useMutation({
    mutationFn: async (body: typeof formData) => {
      return await apiRequest("POST", `/api/smart-replies/${channel}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/smart-replies/${channel}`] });
      closeDialog();
      toast({ title: "Smart reply created" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }: typeof formData & { id: string }) => {
      return await apiRequest("PATCH", `/api/smart-replies/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/smart-replies/${channel}`] });
      closeDialog();
      toast({ title: "Smart reply updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/smart-replies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/smart-replies/${channel}`] });
      setDeleteDialogOpen(false);
      setReplyToDelete(null);
      toast({ title: "Smart reply deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return await apiRequest("PATCH", `/api/smart-replies/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/smart-replies/${channel}`] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  function closeDialog() {
    setIsDialogOpen(false);
    setEditingReply(null);
    setFormData({ keywords: "", responseText: "", responseUrl: "", priority: 0, isActive: true });
  }

  function openEditDialog(reply: SmartReply) {
    setEditingReply(reply);
    setFormData({
      keywords: reply.keywords,
      responseText: reply.responseText,
      responseUrl: reply.responseUrl ?? "",
      priority: reply.priority,
      isActive: reply.isActive,
    });
    setIsDialogOpen(true);
  }

  function handleSubmit() {
    if (!formData.keywords.trim() || !formData.responseText.trim()) {
      toast({ title: "Please fill in keywords and response text", variant: "destructive" });
      return;
    }
    if (editingReply) {
      updateMutation.mutate({ ...formData, id: editingReply.id });
    } else {
      createMutation.mutate(formData);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const sortedReplies = [...replies].sort((a, b) => b.priority - a.priority);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center gap-4">
        <SidebarTrigger />
        {channel === "whatsapp" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/admin/whatsapp")}
            data-testid="button-back-to-whatsapp-hub"
            aria-label="Back to WhatsApp"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold">Smart Replies — {channelLabel}</h1>
        </div>
      </header>

      {headerContent}

      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-sm text-muted-foreground">
              Configure keyword-triggered responses. When a user message contains configured keywords, the AI will paraphrase the response naturally.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditingReply(null);
              setFormData({ keywords: "", responseText: "", responseUrl: "", priority: 0, isActive: true });
              setIsDialogOpen(true);
            }}
            className="bg-purple-600 hover:bg-purple-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Smart Reply
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
          </div>
        ) : sortedReplies.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Zap className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-600 mb-2">No Smart Replies Yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first smart reply to automatically guide AI responses when specific keywords are detected.
              </p>
              <Button
                onClick={() => setIsDialogOpen(true)}
                variant="outline"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Smart Reply
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {sortedReplies.map((reply) => (
              <Card key={reply.id} className={`transition-all ${!reply.isActive ? "opacity-60" : ""}`}>
                <CardContent className="py-4 px-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        {reply.keywords.split(",").map((kw, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {kw.trim()}
                          </Badge>
                        ))}
                        <Badge variant="outline" className="text-xs">
                          Priority: {reply.priority}
                        </Badge>
                        {!reply.isActive && (
                          <Badge variant="destructive" className="text-xs">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-700 mb-1">{reply.responseText}</p>
                      {reply.responseUrl && (
                        <div className="flex items-center gap-1 text-xs text-blue-600">
                          <Link2 className="w-3 h-3" />
                          <span className="truncate">{reply.responseUrl}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={reply.isActive}
                        onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: reply.id, isActive: checked })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(reply)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setReplyToDelete(reply.id);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingReply ? "Edit Smart Reply" : "Add Smart Reply"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Keywords (comma-separated)</Label>
              <Input
                placeholder="e.g. pricing, cost, how much"
                value={formData.keywords}
                onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Trigger words that activate this reply when found in user messages.
              </p>
            </div>
            <div>
              <Label>Response Text</Label>
              <Textarea
                placeholder="The information the AI should convey..."
                value={formData.responseText}
                onChange={(e) => setFormData({ ...formData, responseText: e.target.value })}
                rows={4}
              />
              <p className="text-xs text-muted-foreground mt-1">
                The AI will paraphrase this naturally in its response.
              </p>
            </div>
            <div>
              <Label>URL (optional)</Label>
              <Input
                placeholder="https://example.com/page"
                value={formData.responseUrl}
                onChange={(e) => setFormData({ ...formData, responseUrl: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional link the AI should include in the reply.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label>Priority</Label>
                <Input
                  type="number"
                  min={0}
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Higher priority wins when multiple rules match.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <Switch
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
                <Label>Active</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSaving}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingReply ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Smart Reply</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this smart reply? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteDialogOpen(false); setReplyToDelete(null); }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => replyToDelete && deleteMutation.mutate(replyToDelete)}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
