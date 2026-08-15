import { useState, useEffect, KeyboardEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { ArrowLeft, MessageSquareText, Send, Loader2, Settings, X } from "lucide-react";

interface FacebookSettingsData {
  commentAutoReplyEnabled: string;
  commentReplyMode: string;
  commentTriggerKeywords: string[] | null;
  commentReplyDelay: string;
  commentMaxRepliesPerPost: string;
  commentIgnoreOwnReplies: string;
  [key: string]: any;
}

export default function FacebookCommentSettings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [commentAutoReplyEnabled, setCommentAutoReplyEnabled] = useState(false);
  const [commentReplyMode, setCommentReplyMode] = useState("all");
  const [commentTriggerKeywords, setCommentTriggerKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");
  const [commentReplyDelay, setCommentReplyDelay] = useState(5);
  const [commentMaxRepliesPerPost, setCommentMaxRepliesPerPost] = useState("50");
  const [commentIgnoreOwnReplies, setCommentIgnoreOwnReplies] = useState(true);
  const [commentAutoDmEnabled, setCommentAutoDmEnabled] = useState(false);
  const [commentDmMode, setCommentDmMode] = useState("all");
  const [commentDmTriggerKeywords, setCommentDmTriggerKeywords] = useState<string[]>([]);
  const [dmKeywordInput, setDmKeywordInput] = useState("");
  const [commentDmTemplate, setCommentDmTemplate] = useState("");

  const { data: settings, isLoading } = useQuery<FacebookSettingsData>({
    queryKey: ["/api/facebook/settings"],
    queryFn: async () => {
      return await apiRequest("GET", "/api/facebook/settings");
    },
  });

  useEffect(() => {
    if (settings) {
      setCommentAutoReplyEnabled(settings.commentAutoReplyEnabled === "true");
      setCommentReplyMode(settings.commentReplyMode || "all");
      setCommentTriggerKeywords(Array.isArray(settings.commentTriggerKeywords) ? settings.commentTriggerKeywords : []);
      setCommentReplyDelay(parseInt(settings.commentReplyDelay || "5", 10));
      setCommentMaxRepliesPerPost(settings.commentMaxRepliesPerPost || "50");
      setCommentIgnoreOwnReplies(settings.commentIgnoreOwnReplies !== "false");
      setCommentAutoDmEnabled(settings.commentAutoDmEnabled === "true");
      setCommentDmMode(settings.commentDmMode || "all");
      setCommentDmTriggerKeywords(Array.isArray(settings.commentDmTriggerKeywords) ? settings.commentDmTriggerKeywords : []);
      setCommentDmTemplate(settings.commentDmTemplate || "");
    }
  }, [settings]);

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PUT", "/api/facebook/settings", {
        commentAutoReplyEnabled: commentAutoReplyEnabled ? "true" : "false",
        commentReplyMode,
        commentTriggerKeywords,
        commentReplyDelay: String(commentReplyDelay),
        commentMaxRepliesPerPost,
        commentIgnoreOwnReplies: commentIgnoreOwnReplies ? "true" : "false",
        commentAutoDmEnabled: commentAutoDmEnabled ? "true" : "false",
        commentDmMode,
        commentDmTriggerKeywords,
        commentDmTemplate: commentDmTemplate || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/facebook/settings"] });
      toast({ title: "Settings saved", description: "Comment settings updated." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save settings", variant: "destructive" });
    },
  });

  const addKeyword = (keyword: string) => {
    const trimmed = keyword.trim().toLowerCase();
    if (trimmed && !commentTriggerKeywords.includes(trimmed)) {
      setCommentTriggerKeywords([...commentTriggerKeywords, trimmed]);
    }
    setKeywordInput("");
  };

  const removeKeyword = (keyword: string) => {
    setCommentTriggerKeywords(commentTriggerKeywords.filter((k) => k !== keyword));
  };

  const handleKeywordKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeyword(keywordInput);
    }
  };

  const addDmKeyword = (keyword: string) => {
    const trimmed = keyword.trim().toLowerCase();
    if (trimmed && !commentDmTriggerKeywords.includes(trimmed)) {
      setCommentDmTriggerKeywords([...commentDmTriggerKeywords, trimmed]);
    }
    setDmKeywordInput("");
  };

  const removeDmKeyword = (keyword: string) => {
    setCommentDmTriggerKeywords(commentDmTriggerKeywords.filter((k) => k !== keyword));
  };

  const handleDmKeywordKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addDmKeyword(dmKeywordInput);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-50 flex items-center gap-4 border-b bg-gradient-to-r from-blue-600 to-blue-500 px-4 h-14 shrink-0">
        <SidebarTrigger className="text-white hover:text-white/80" />
        <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/facebook-comments")} className="gap-1 text-white/80 hover:text-white hover:bg-white/10">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-white" />
          <h1 className="text-lg font-semibold text-white">Comment Auto-Reply Settings</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 max-w-3xl">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MessageSquareText className="w-5 h-5 text-blue-600" />
              <div>
                <CardTitle>Comment Auto-Reply</CardTitle>
                <CardDescription>
                  When enabled, the AI agent will automatically reply to comments on your Facebook posts using your training data and FAQs.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Comment Auto-Reply</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically respond to Facebook post comments with AI-generated replies
                </p>
              </div>
              <Switch
                checked={commentAutoReplyEnabled}
                onCheckedChange={setCommentAutoReplyEnabled}
              />
            </div>

            {commentAutoReplyEnabled && (
              <>
                <div className="space-y-2">
                  <Label>Reply Mode</Label>
                  <Select value={commentReplyMode} onValueChange={setCommentReplyMode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Reply to all comments</SelectItem>
                      <SelectItem value="keyword_only">Reply only to keyword triggers</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Choose whether to reply to every comment or only those containing specific keywords.
                  </p>
                </div>

                {commentReplyMode === "keyword_only" && (
                  <div className="space-y-2">
                    <Label>Trigger Keywords</Label>
                    <div className="flex gap-2">
                      <Input
                        value={keywordInput}
                        onChange={(e) => setKeywordInput(e.target.value)}
                        onKeyDown={handleKeywordKeyDown}
                        placeholder="Type a keyword and press Enter"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => addKeyword(keywordInput)}
                        disabled={!keywordInput.trim()}
                      >
                        Add
                      </Button>
                    </div>
                    {commentTriggerKeywords.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {commentTriggerKeywords.map((keyword) => (
                          <Badge key={keyword} variant="secondary" className="gap-1 pl-2 pr-1">
                            {keyword}
                            <button
                              onClick={() => removeKeyword(keyword)}
                              className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Only comments containing these keywords will trigger an auto-reply.
                    </p>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Reply Delay</Label>
                    <span className="text-sm text-muted-foreground">{commentReplyDelay}s</span>
                  </div>
                  <Slider
                    value={[commentReplyDelay]}
                    onValueChange={([val]) => setCommentReplyDelay(val)}
                    min={1}
                    max={30}
                    step={1}
                  />
                  <p className="text-xs text-muted-foreground">
                    Wait this many seconds before replying to avoid looking automated (1–30 seconds).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="commentMaxReplies">Max Replies Per Post</Label>
                  <Input
                    id="commentMaxReplies"
                    type="number"
                    min={1}
                    max={500}
                    value={commentMaxRepliesPerPost}
                    onChange={(e) => setCommentMaxRepliesPerPost(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Limit the number of auto-replies per post to avoid excessive commenting.
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Ignore Own Replies</Label>
                    <p className="text-xs text-muted-foreground">
                      Skip comments from your own Facebook account
                    </p>
                  </div>
                  <Switch
                    checked={commentIgnoreOwnReplies}
                    onCheckedChange={setCommentIgnoreOwnReplies}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Send className="w-5 h-5 text-purple-600" />
              <div>
                <CardTitle>Auto-DM Commenters</CardTitle>
                <CardDescription>
                  Automatically send a private message to users who comment on your posts. The AI will generate a personalized message based on their comment.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Auto-DM</Label>
                <p className="text-xs text-muted-foreground">
                  Send a private message to commenters after replying to their comment
                </p>
              </div>
              <Switch
                checked={commentAutoDmEnabled}
                onCheckedChange={setCommentAutoDmEnabled}
              />
            </div>

            {commentAutoDmEnabled && (
              <>
                <div className="space-y-2">
                  <Label>DM Trigger Mode</Label>
                  <Select value={commentDmMode} onValueChange={setCommentDmMode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">DM all commenters</SelectItem>
                      <SelectItem value="keyword_only">DM only keyword-triggered comments</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Choose whether to DM every commenter or only those whose comments contain specific keywords.
                  </p>
                </div>

                {commentDmMode === "keyword_only" && (
                  <div className="space-y-2">
                    <Label>DM Trigger Keywords</Label>
                    <div className="flex gap-2">
                      <Input
                        value={dmKeywordInput}
                        onChange={(e) => setDmKeywordInput(e.target.value)}
                        onKeyDown={handleDmKeywordKeyDown}
                        placeholder="Type a keyword and press Enter"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => addDmKeyword(dmKeywordInput)}
                        disabled={!dmKeywordInput.trim()}
                      >
                        Add
                      </Button>
                    </div>
                    {commentDmTriggerKeywords.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {commentDmTriggerKeywords.map((keyword) => (
                          <Badge key={keyword} variant="secondary" className="gap-1 pl-2 pr-1">
                            {keyword}
                            <button
                              onClick={() => removeDmKeyword(keyword)}
                              className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Only comments containing these keywords will trigger an auto-DM.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>DM Instructions (optional)</Label>
                  <Textarea
                    value={commentDmTemplate}
                    onChange={(e) => setCommentDmTemplate(e.target.value)}
                    placeholder="e.g., Always include our website link. Mention current offers. Ask them to book a consultation."
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    Custom instructions for the AI when generating DMs. The AI will use your training data plus these instructions to create personalized messages.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Button
          onClick={() => saveSettingsMutation.mutate()}
          disabled={saveSettingsMutation.isPending}
          className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600"
        >
          {saveSettingsMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Comment Settings"
          )}
        </Button>
      </div>
    </div>
  );
}
