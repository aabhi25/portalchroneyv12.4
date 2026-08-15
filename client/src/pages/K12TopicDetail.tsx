import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, FileText, Video, HelpCircle, Plus, Trash2, CheckCircle, XCircle, Loader2, Edit, Save, ExternalLink, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Topic {
  id: string;
  chapterId: string;
  businessAccountId: string;
  name: string;
  description: string | null;
  tags: string[];
  sortOrder: number;
}

interface TopicNote {
  id: string;
  topicId: string;
  title: string;
  content: string;
  sortOrder: number;
}

interface TopicVideo {
  id: string;
  topicId: string;
  title: string;
  videoUrl: string;
  transcript: string | null;
  sortOrder: number;
}

interface Question {
  id: string;
  topicId: string;
  questionHtml: string;
  questionType: string;
  options: { text: string; isCorrect: boolean }[];
  solutionHtml: string | null;
  difficulty: number | null;
  marks: number | null;
  sortOrder: number;
}

export default function K12TopicDetail() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Topic>>({});

  const [addNoteOpen, setAddNoteOpen] = useState(false);
  const [newNote, setNewNote] = useState({ title: "", content: "" });
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteData, setEditNoteData] = useState({ title: "", content: "" });

  const [addVideoOpen, setAddVideoOpen] = useState(false);
  const [newVideo, setNewVideo] = useState({ title: "", videoUrl: "", transcript: "" });
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const [editVideoData, setEditVideoData] = useState({ title: "", videoUrl: "", transcript: "" });

  const [addQuestionOpen, setAddQuestionOpen] = useState(false);
  const [newQuestion, setNewQuestion] = useState({
    questionHtml: "",
    options: [
      { text: "", isCorrect: true },
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
      { text: "", isCorrect: false },
    ],
    solutionHtml: "",
    difficulty: 5,
  });

  const { data: topic, isLoading: topicLoading } = useQuery<Topic>({
    queryKey: [`/api/k12/topics/${params.id}`],
    enabled: !!params.id,
  });

  const { data: notes } = useQuery<TopicNote[]>({
    queryKey: [`/api/k12/topics/${params.id}/notes`],
    enabled: !!params.id,
  });

  const { data: videos } = useQuery<TopicVideo[]>({
    queryKey: [`/api/k12/topics/${params.id}/videos`],
    enabled: !!params.id,
  });

  const { data: questions, isLoading: questionsLoading } = useQuery<Question[]>({
    queryKey: [`/api/k12/topics/${params.id}/questions`],
    enabled: !!params.id,
  });

  const updateTopicMutation = useMutation({
    mutationFn: (data: Partial<Topic>) => apiRequest("PUT", `/api/k12/topics/${params.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/k12/topics/${params.id}`] });
      setEditing(false);
      toast({ title: "Topic updated" });
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: (data: { title: string; content: string }) => apiRequest("POST", `/api/k12/topics/${params.id}/notes`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/k12/topics/${params.id}/notes`] });
      setAddNoteOpen(false);
      setNewNote({ title: "", content: "" });
      toast({ title: "Note added" });
    },
    onError: () => { toast({ title: "Failed to add note", variant: "destructive" }); },
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; title: string; content: string }) => apiRequest("PUT", `/api/k12/notes/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/k12/topics/${params.id}/notes`] });
      setEditingNoteId(null);
      toast({ title: "Note updated" });
    },
    onError: () => { toast({ title: "Failed to update note", variant: "destructive" }); },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/k12/notes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/k12/topics/${params.id}/notes`] });
      toast({ title: "Note deleted" });
    },
    onError: () => { toast({ title: "Failed to delete note", variant: "destructive" }); },
  });

  const addVideoMutation = useMutation({
    mutationFn: (data: { title: string; videoUrl: string; transcript: string }) => apiRequest("POST", `/api/k12/topics/${params.id}/videos`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/k12/topics/${params.id}/videos`] });
      setAddVideoOpen(false);
      setNewVideo({ title: "", videoUrl: "", transcript: "" });
      toast({ title: "Video added" });
    },
    onError: () => { toast({ title: "Failed to add video", variant: "destructive" }); },
  });

  const updateVideoMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string; title: string; videoUrl: string; transcript: string }) => apiRequest("PUT", `/api/k12/videos/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/k12/topics/${params.id}/videos`] });
      setEditingVideoId(null);
      toast({ title: "Video updated" });
    },
    onError: () => { toast({ title: "Failed to update video", variant: "destructive" }); },
  });

  const deleteVideoMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/k12/videos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/k12/topics/${params.id}/videos`] });
      toast({ title: "Video deleted" });
    },
    onError: () => { toast({ title: "Failed to delete video", variant: "destructive" }); },
  });

  const addQuestionMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/k12/questions", { ...data, topicId: params.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/k12/topics/${params.id}/questions`] });
      setAddQuestionOpen(false);
      setNewQuestion({
        questionHtml: "",
        options: [
          { text: "", isCorrect: true },
          { text: "", isCorrect: false },
          { text: "", isCorrect: false },
          { text: "", isCorrect: false },
        ],
        solutionHtml: "",
        difficulty: 5,
      });
      toast({ title: "Question added" });
    },
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/k12/questions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/k12/topics/${params.id}/questions`] });
      toast({ title: "Question deleted" });
    },
  });

  const startEditing = () => {
    if (topic) {
      setEditData({
        name: topic.name,
        description: topic.description,
        tags: topic.tags,
      });
      setEditing(true);
    }
  };

  const updateOption = (index: number, field: "text" | "isCorrect", value: any) => {
    const opts = [...newQuestion.options];
    if (field === "isCorrect") {
      opts.forEach((o, i) => { o.isCorrect = i === index; });
    } else {
      opts[index] = { ...opts[index], [field]: value };
    }
    setNewQuestion({ ...newQuestion, options: opts });
  };

  if (topicLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!topic) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-gray-500">Topic not found</p>
        <Button variant="link" onClick={() => setLocation("/admin/k12/content")}>Back to Content</Button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/k12/content")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div>
          {editing ? (
            <div className="space-y-2">
              <Input
                value={editData.name || ""}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                className="text-xl font-bold"
              />
              <Textarea
                value={editData.description || ""}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                placeholder="Description..."
                rows={2}
                className="text-sm"
              />
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold">{topic.name}</h1>
              {topic.description && (
                <p className="text-sm text-gray-600 mt-1">{topic.description}</p>
              )}
              {topic.tags && topic.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {topic.tags.map((tag, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {!editing ? (
          <Button variant="outline" size="sm" onClick={startEditing}>
            <Edit className="w-4 h-4 mr-1" /> Edit
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => updateTopicMutation.mutate(editData)} disabled={updateTopicMutation.isPending}>
              <Save className="w-4 h-4 mr-1" /> Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <FileText className="w-4 h-4 mr-1" /> Overview
          </TabsTrigger>
          <TabsTrigger value="questions">
            <HelpCircle className="w-4 h-4 mr-1" /> Questions ({questions?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <BookOpen className="w-5 h-5" /> Revision Notes
              </h2>
              <Dialog open={addNoteOpen} onOpenChange={setAddNoteOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Plus className="w-4 h-4 mr-1" /> Add Note
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Add Revision Note</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Title</Label>
                      <Input
                        value={newNote.title}
                        onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
                        placeholder="e.g. Key Concepts, Formulas..."
                      />
                    </div>
                    <div>
                      <Label>Content</Label>
                      <Textarea
                        value={newNote.content}
                        onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
                        placeholder="Enter revision notes in plain text..."
                        rows={8}
                      />
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => addNoteMutation.mutate({ title: newNote.title || "Revision Notes", content: newNote.content })}
                      disabled={!newNote.content || addNoteMutation.isPending}
                    >
                      Add Note
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {(!notes || notes.length === 0) ? (
              <Card>
                <CardContent className="py-8 text-center text-gray-400">
                  <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No revision notes yet. Add your first note.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <Card key={note.id}>
                    {editingNoteId === note.id ? (
                      <CardContent className="pt-4 space-y-3">
                        <Input
                          value={editNoteData.title}
                          onChange={(e) => setEditNoteData({ ...editNoteData, title: e.target.value })}
                          placeholder="Title"
                        />
                        <Textarea
                          value={editNoteData.content}
                          onChange={(e) => setEditNoteData({ ...editNoteData, content: e.target.value })}
                          rows={6}
                        />
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={() => updateNoteMutation.mutate({ id: note.id, ...editNoteData })}
                            disabled={updateNoteMutation.isPending}
                          >
                            <Save className="w-4 h-4 mr-1" /> Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingNoteId(null)}>Cancel</Button>
                        </div>
                      </CardContent>
                    ) : (
                      <>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium">{note.title}</CardTitle>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingNoteId(note.id);
                                  setEditNoteData({ title: note.title, content: note.content });
                                }}
                                className="h-7 w-7 p-0 text-gray-400 hover:text-blue-500"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteNoteMutation.mutate(note.id)}
                                className="h-7 w-7 p-0 text-gray-400 hover:text-red-500"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{note.content}</p>
                        </CardContent>
                      </>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Video className="w-5 h-5" /> Videos
              </h2>
              <Dialog open={addVideoOpen} onOpenChange={setAddVideoOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Plus className="w-4 h-4 mr-1" /> Add Video
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Add Video</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Title</Label>
                      <Input
                        value={newVideo.title}
                        onChange={(e) => setNewVideo({ ...newVideo, title: e.target.value })}
                        placeholder="e.g. Introduction, Worked Examples..."
                      />
                    </div>
                    <div>
                      <Label>Video URL</Label>
                      <Input
                        value={newVideo.videoUrl}
                        onChange={(e) => setNewVideo({ ...newVideo, videoUrl: e.target.value })}
                        placeholder="https://youtube.com/watch?v=..."
                      />
                    </div>
                    <div>
                      <Label>Transcript (optional — helps AI answer questions from this video)</Label>
                      <Textarea
                        value={newVideo.transcript}
                        onChange={(e) => setNewVideo({ ...newVideo, transcript: e.target.value })}
                        placeholder="Paste the video transcript here so the AI can use it to answer student questions..."
                        rows={6}
                      />
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => addVideoMutation.mutate({ title: newVideo.title || "Video", videoUrl: newVideo.videoUrl, transcript: newVideo.transcript })}
                      disabled={!newVideo.videoUrl || addVideoMutation.isPending}
                    >
                      Add Video
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {(!videos || videos.length === 0) ? (
              <Card>
                <CardContent className="py-8 text-center text-gray-400">
                  <Video className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No videos yet. Add a video with its URL and transcript.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {videos.map((video) => (
                  <Card key={video.id}>
                    {editingVideoId === video.id ? (
                      <CardContent className="pt-4 space-y-3">
                        <div>
                          <Label>Title</Label>
                          <Input
                            value={editVideoData.title}
                            onChange={(e) => setEditVideoData({ ...editVideoData, title: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label>Video URL</Label>
                          <Input
                            value={editVideoData.videoUrl}
                            onChange={(e) => setEditVideoData({ ...editVideoData, videoUrl: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label>Transcript</Label>
                          <Textarea
                            value={editVideoData.transcript}
                            onChange={(e) => setEditVideoData({ ...editVideoData, transcript: e.target.value })}
                            rows={6}
                          />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={() => updateVideoMutation.mutate({ id: video.id, ...editVideoData })}
                            disabled={updateVideoMutation.isPending}
                          >
                            <Save className="w-4 h-4 mr-1" /> Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingVideoId(null)}>Cancel</Button>
                        </div>
                      </CardContent>
                    ) : (
                      <>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                              <Video className="w-4 h-4 text-blue-500" />
                              {video.title}
                            </CardTitle>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingVideoId(video.id);
                                  setEditVideoData({ title: video.title, videoUrl: video.videoUrl, transcript: video.transcript || "" });
                                }}
                                className="h-7 w-7 p-0 text-gray-400 hover:text-blue-500"
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteVideoMutation.mutate(video.id)}
                                className="h-7 w-7 p-0 text-gray-400 hover:text-red-500"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <a
                            href={video.videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {video.videoUrl}
                          </a>
                          {video.transcript ? (
                            <div className="bg-gray-50 rounded-md p-3 mt-2">
                              <p className="text-xs text-gray-400 mb-1 font-medium">Transcript</p>
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                {video.transcript.length > 300 ? video.transcript.substring(0, 300) + "..." : video.transcript}
                              </p>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400 italic">No transcript added</p>
                          )}
                        </CardContent>
                      </>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="questions" className="space-y-4 mt-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{questions?.length || 0} question{(questions?.length || 0) !== 1 ? "s" : ""}</p>
            <Dialog open={addQuestionOpen} onOpenChange={setAddQuestionOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-1" /> Add Question
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add Question</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                  <div>
                    <Label>Question</Label>
                    <Textarea
                      value={newQuestion.questionHtml}
                      onChange={(e) => setNewQuestion({ ...newQuestion, questionHtml: e.target.value })}
                      placeholder="Enter question text..."
                      rows={3}
                    />
                  </div>
                  <div>
                    <Label>Options (click radio to mark correct answer)</Label>
                    <div className="space-y-2 mt-2">
                      {newQuestion.options.map((opt, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="correct"
                            checked={opt.isCorrect}
                            onChange={() => updateOption(i, "isCorrect", true)}
                            className="w-4 h-4"
                          />
                          <Input
                            value={opt.text}
                            onChange={(e) => updateOption(i, "text", e.target.value)}
                            placeholder={`Option ${String.fromCharCode(65 + i)}`}
                            className="h-8 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label>Solution Explanation</Label>
                    <Textarea
                      value={newQuestion.solutionHtml}
                      onChange={(e) => setNewQuestion({ ...newQuestion, solutionHtml: e.target.value })}
                      rows={3}
                    />
                  </div>
                  <div>
                    <Label>Difficulty (1-10)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={newQuestion.difficulty}
                      onChange={(e) => setNewQuestion({ ...newQuestion, difficulty: parseInt(e.target.value) || 5 })}
                      className="w-24"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => addQuestionMutation.mutate(newQuestion)}
                    disabled={!newQuestion.questionHtml || addQuestionMutation.isPending}
                  >
                    Add Question
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {questionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="space-y-3">
              {questions?.map((q, idx) => (
                <Card key={q.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="text-xs">Q{idx + 1}</Badge>
                          {q.difficulty && <Badge variant="secondary" className="text-xs">Difficulty: {q.difficulty}/10</Badge>}
                        </div>
                        <div className="text-sm mb-3" dangerouslySetInnerHTML={{ __html: q.questionHtml }} />
                        <div className="space-y-1.5">
                          {q.options.map((opt, oi) => (
                            <div key={oi} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-md ${opt.isCorrect ? "bg-green-50 text-green-800" : "bg-gray-50"}`}>
                              {opt.isCorrect ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-gray-300" />}
                              <span>{String.fromCharCode(65 + oi)}. {opt.text}</span>
                            </div>
                          ))}
                        </div>
                        {q.solutionHtml && (
                          <div className="mt-3 pt-3 border-t">
                            <p className="text-xs text-gray-400 mb-1 font-medium">Solution:</p>
                            <div className="text-sm text-gray-600" dangerouslySetInnerHTML={{ __html: q.solutionHtml }} />
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteQuestionMutation.mutate(q.id)}
                        className="text-gray-400 hover:text-red-500 ml-2"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
