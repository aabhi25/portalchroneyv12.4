import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { K12_BOARDS, K12_GRADES, K12_LANGUAGES, getBoardLabel, getGradeLabel, getLanguageLabel } from "@/lib/k12Constants";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ChevronRight, Plus, Trash2, FolderOpen, FileText, GraduationCap, Loader2, Database, Filter, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Subject {
  id: string;
  name: string;
  language: string;
  grade: string | null;
  board: string | null;
  sortOrder: number;
}

interface Chapter {
  id: string;
  subjectId: string;
  name: string;
  sortOrder: number;
}

interface Topic {
  id: string;
  chapterId: string;
  name: string;
  description: string | null;
  tags: string[];
  sortOrder: number;
}

interface ContentTree extends Subject {
  chapters: (Chapter & { topics: Topic[] })[];
}

export default function K12Content() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [addSubjectOpen, setAddSubjectOpen] = useState(false);
  const [addChapterOpen, setAddChapterOpen] = useState<string | null>(null);
  const [addTopicOpen, setAddTopicOpen] = useState<string | null>(null);
  const [newSubject, setNewSubject] = useState({ name: "", language: "en", grade: "", board: "" });
  const [newChapter, setNewChapter] = useState({ name: "" });
  const [newTopic, setNewTopic] = useState({ name: "", description: "" });

  const [selectedBoard, setSelectedBoard] = useState<string>("");
  const [selectedMedium, setSelectedMedium] = useState<string>("");
  const [selectedGrade, setSelectedGrade] = useState<string>("");

  const { data: contentTree, isLoading } = useQuery<ContentTree[]>({
    queryKey: ["/api/k12/content-tree"],
  });

  const availableBoards = useMemo(() => {
    if (!contentTree) return [];
    const boards = new Set(contentTree.map((s) => s.board).filter(Boolean) as string[]);
    return Array.from(boards).sort();
  }, [contentTree]);

  const availableMediums = useMemo(() => {
    if (!contentTree) return [];
    const filtered = selectedBoard
      ? contentTree.filter((s) => s.board === selectedBoard)
      : contentTree;
    const mediums = new Set(filtered.map((s) => s.language));
    return Array.from(mediums).sort();
  }, [contentTree, selectedBoard]);

  const availableGrades = useMemo(() => {
    if (!contentTree) return [];
    let filtered = contentTree;
    if (selectedBoard) filtered = filtered.filter((s) => s.board === selectedBoard);
    if (selectedMedium) filtered = filtered.filter((s) => s.language === selectedMedium);
    const grades = new Set(filtered.map((s) => s.grade).filter(Boolean) as string[]);
    return Array.from(grades).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [contentTree, selectedBoard, selectedMedium]);

  const filteredTree = useMemo(() => {
    if (!contentTree) return [];
    return contentTree.filter((subject) => {
      if (selectedBoard && subject.board !== selectedBoard) return false;
      if (selectedMedium && subject.language !== selectedMedium) return false;
      if (selectedGrade && subject.grade !== selectedGrade) return false;
      return true;
    });
  }, [contentTree, selectedBoard, selectedMedium, selectedGrade]);

  const hasActiveFilters = selectedBoard || selectedMedium || selectedGrade;

  const autoSelectContext = useMemo(() => {
    if (availableBoards.length === 1 && !selectedBoard) return { board: availableBoards[0] };
    return null;
  }, [availableBoards, selectedBoard]);

  if (autoSelectContext?.board && !selectedBoard) {
    setTimeout(() => setSelectedBoard(autoSelectContext.board), 0);
  }

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/k12/seed-sample-data"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/k12/content-tree"] });
      toast({ title: "Sample data loaded successfully" });
    },
  });

  const addSubjectMutation = useMutation({
    mutationFn: (data: typeof newSubject) => apiRequest("POST", "/api/k12/subjects", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/k12/content-tree"] });
      setAddSubjectOpen(false);
      setNewSubject({ name: "", language: selectedMedium || "en", grade: selectedGrade || "", board: selectedBoard || "" });
      toast({ title: "Subject added" });
    },
  });

  const addChapterMutation = useMutation({
    mutationFn: (data: { subjectId: string; name: string }) => apiRequest("POST", "/api/k12/chapters", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/k12/content-tree"] });
      setAddChapterOpen(null);
      setNewChapter({ name: "" });
      toast({ title: "Chapter added" });
    },
  });

  const addTopicMutation = useMutation({
    mutationFn: (data: { chapterId: string; name: string; description: string }) => apiRequest("POST", "/api/k12/topics", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/k12/content-tree"] });
      setAddTopicOpen(null);
      setNewTopic({ name: "", description: "" });
      toast({ title: "Topic added" });
    },
  });

  const deleteSubjectMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/k12/subjects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/k12/content-tree"] });
      toast({ title: "Subject deleted" });
    },
  });

  const toggleSubject = (id: string) => {
    const next = new Set(expandedSubjects);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedSubjects(next);
  };

  const toggleChapter = (id: string) => {
    const next = new Set(expandedChapters);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedChapters(next);
  };

  const handleOpenAddSubject = () => {
    setNewSubject({
      name: "",
      language: selectedMedium || "en",
      grade: selectedGrade || "",
      board: selectedBoard || "",
    });
    setAddSubjectOpen(true);
  };

  const clearFilters = () => {
    setSelectedBoard("");
    setSelectedMedium("");
    setSelectedGrade("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const isEmpty = !contentTree || contentTree.length === 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-blue-600" />
            K12 Content
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage subjects, chapters, topics, and questions</p>
        </div>
        <div className="flex gap-2">
          {isEmpty && (
            <Button
              variant="outline"
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
            >
              {seedMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Database className="w-4 h-4 mr-2" />}
              Load Sample Data
            </Button>
          )}
          <Dialog open={addSubjectOpen} onOpenChange={setAddSubjectOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleOpenAddSubject}>
                <Plus className="w-4 h-4 mr-2" />
                Add Subject
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Subject</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Board</Label>
                  <SearchableSelect
                    value={newSubject.board}
                    onValueChange={(v) => setNewSubject({ ...newSubject, board: v })}
                    placeholder="Select board"
                    searchPlaceholder="Search boards..."
                    groups={K12_BOARDS}
                    emptyMessage="No board found."
                  />
                </div>
                <div>
                  <Label>Medium (Language)</Label>
                  <SearchableSelect
                    value={newSubject.language}
                    onValueChange={(v) => setNewSubject({ ...newSubject, language: v })}
                    placeholder="Select medium"
                    searchPlaceholder="Search languages..."
                    options={K12_LANGUAGES}
                    emptyMessage="No language found."
                  />
                </div>
                <div>
                  <Label>Grade</Label>
                  <SearchableSelect
                    value={newSubject.grade}
                    onValueChange={(v) => setNewSubject({ ...newSubject, grade: v })}
                    placeholder="Select grade"
                    searchPlaceholder="Search grades..."
                    groups={K12_GRADES}
                    emptyMessage="No grade found."
                  />
                </div>
                <div>
                  <Label>Subject Name</Label>
                  <Input
                    value={newSubject.name}
                    onChange={(e) => setNewSubject({ ...newSubject, name: e.target.value })}
                    placeholder="e.g. Mathematics II"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => addSubjectMutation.mutate(newSubject)}
                  disabled={!newSubject.name || !newSubject.board || addSubjectMutation.isPending}
                >
                  Add Subject
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!isEmpty && (
        <Card className="bg-gradient-to-r from-slate-50 to-gray-50 border-gray-200">
          <CardContent className="py-4 px-5">
            <div className="flex items-center gap-2 mb-3">
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-semibold text-gray-600">Filter Content</span>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-gray-400 hover:text-gray-600 ml-auto"
                  onClick={clearFilters}
                >
                  <X className="w-3 h-3 mr-1" />
                  Clear all
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="min-w-[180px]">
                <label className="text-xs font-medium text-gray-500 mb-1 block">Board</label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => { setSelectedBoard(""); setSelectedMedium(""); setSelectedGrade(""); }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      !selectedBoard
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-white text-gray-600 border border-gray-200 hover:border-blue-300 hover:text-blue-600"
                    }`}
                  >
                    All Boards
                  </button>
                  {availableBoards.map((board) => (
                    <button
                      key={board}
                      onClick={() => { setSelectedBoard(board); setSelectedMedium(""); setSelectedGrade(""); }}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        selectedBoard === board
                          ? "bg-blue-600 text-white shadow-sm"
                          : "bg-white text-gray-600 border border-gray-200 hover:border-blue-300 hover:text-blue-600"
                      }`}
                    >
                      {getBoardLabel(board)}
                    </button>
                  ))}
                </div>
              </div>

              {(selectedBoard || availableMediums.length > 1) && (
                <div className="min-w-[140px]">
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Medium</label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => { setSelectedMedium(""); setSelectedGrade(""); }}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        !selectedMedium
                          ? "bg-emerald-600 text-white shadow-sm"
                          : "bg-white text-gray-600 border border-gray-200 hover:border-emerald-300 hover:text-emerald-600"
                      }`}
                    >
                      All
                    </button>
                    {availableMediums.map((medium) => (
                      <button
                        key={medium}
                        onClick={() => { setSelectedMedium(medium); setSelectedGrade(""); }}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                          selectedMedium === medium
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "bg-white text-gray-600 border border-gray-200 hover:border-emerald-300 hover:text-emerald-600"
                        }`}
                      >
                        {getLanguageLabel(medium)} Medium
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(selectedBoard || selectedMedium) && availableGrades.length > 1 && (
                <div className="min-w-[140px]">
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Grade</label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setSelectedGrade("")}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        !selectedGrade
                          ? "bg-purple-600 text-white shadow-sm"
                          : "bg-white text-gray-600 border border-gray-200 hover:border-purple-300 hover:text-purple-600"
                      }`}
                    >
                      All
                    </button>
                    {availableGrades.map((grade) => (
                      <button
                        key={grade}
                        onClick={() => setSelectedGrade(grade)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                          selectedGrade === grade
                            ? "bg-purple-600 text-white shadow-sm"
                            : "bg-white text-gray-600 border border-gray-200 hover:border-purple-300 hover:text-purple-600"
                        }`}
                      >
                        {getGradeLabel(grade)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {hasActiveFilters && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>Showing:</span>
          {selectedBoard && (
            <Badge variant="secondary" className="text-xs gap-1">
              {getBoardLabel(selectedBoard)}
              <X className="w-3 h-3 cursor-pointer hover:text-red-500" onClick={() => { setSelectedBoard(""); setSelectedMedium(""); setSelectedGrade(""); }} />
            </Badge>
          )}
          {selectedMedium && (
            <Badge variant="secondary" className="text-xs gap-1 bg-emerald-50 text-emerald-700 border-emerald-200">
              {getLanguageLabel(selectedMedium)} Medium
              <X className="w-3 h-3 cursor-pointer hover:text-red-500" onClick={() => { setSelectedMedium(""); setSelectedGrade(""); }} />
            </Badge>
          )}
          {selectedGrade && (
            <Badge variant="secondary" className="text-xs gap-1 bg-purple-50 text-purple-700 border-purple-200">
              {getGradeLabel(selectedGrade)}
              <X className="w-3 h-3 cursor-pointer hover:text-red-500" onClick={() => setSelectedGrade("")} />
            </Badge>
          )}
          <span className="text-gray-400">({filteredTree.length} subject{filteredTree.length !== 1 ? "s" : ""})</span>
        </div>
      )}

      {isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <GraduationCap className="w-16 h-16 text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-700">No content yet</h3>
            <p className="text-sm text-gray-500 mt-1 text-center max-w-md">
              Start by loading sample data or adding your first subject. You can organize content into subjects, chapters, and topics.
            </p>
          </CardContent>
        </Card>
      ) : filteredTree.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Filter className="w-12 h-12 text-gray-300 mb-3" />
            <h3 className="text-base font-semibold text-gray-600">No subjects match your filters</h3>
            <p className="text-sm text-gray-400 mt-1">Try adjusting your Board, Medium, or Grade selection</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
              Clear Filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredTree.map((subject) => (
            <Card key={subject.id} className="overflow-hidden">
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleSubject(subject.id)}
              >
                <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${expandedSubjects.has(subject.id) ? "rotate-90" : ""}`} />
                <FolderOpen className="w-5 h-5 text-blue-500" />
                <div className="flex-1">
                  <span className="font-medium">{subject.name}</span>
                  <div className="flex gap-2 mt-0.5">
                    {subject.grade && <Badge variant="secondary" className="text-xs">{getGradeLabel(subject.grade)}</Badge>}
                    <Badge variant="outline" className="text-xs">{getLanguageLabel(subject.language)}</Badge>
                    {subject.board && <Badge variant="outline" className="text-xs">{getBoardLabel(subject.board)}</Badge>}
                  </div>
                </div>
                <span className="text-sm text-gray-400">{subject.chapters.length} chapter{subject.chapters.length !== 1 ? "s" : ""}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); deleteSubjectMutation.mutate(subject.id); }}
                  className="text-gray-400 hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              {expandedSubjects.has(subject.id) && (
                <div className="border-t bg-gray-50/50">
                  {subject.chapters.map((chapter) => (
                    <div key={chapter.id}>
                      <div
                        className="flex items-center gap-3 px-8 py-3 cursor-pointer hover:bg-gray-100/60 transition-colors"
                        onClick={() => toggleChapter(chapter.id)}
                      >
                        <ChevronRight className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expandedChapters.has(chapter.id) ? "rotate-90" : ""}`} />
                        <BookOpen className="w-4 h-4 text-indigo-500" />
                        <span className="font-medium text-sm">{chapter.name}</span>
                        <span className="text-xs text-gray-400 ml-auto">{chapter.topics.length} topic{chapter.topics.length !== 1 ? "s" : ""}</span>
                      </div>

                      {expandedChapters.has(chapter.id) && (
                        <div className="bg-white/60">
                          {chapter.topics.map((topic) => (
                            <div
                              key={topic.id}
                              className="flex items-center gap-3 px-14 py-2.5 cursor-pointer hover:bg-blue-50/60 transition-colors border-t border-gray-100"
                              onClick={() => setLocation(`/admin/k12/topic/${topic.id}`)}
                            >
                              <FileText className="w-4 h-4 text-green-500" />
                              <span className="text-sm">{topic.name}</span>
                              <ChevronRight className="w-3.5 h-3.5 text-gray-300 ml-auto" />
                            </div>
                          ))}
                          <div className="px-14 py-2">
                            {addTopicOpen === chapter.id ? (
                              <div className="flex gap-2 items-end">
                                <div className="flex-1 space-y-1">
                                  <Input
                                    value={newTopic.name}
                                    onChange={(e) => setNewTopic({ ...newTopic, name: e.target.value })}
                                    placeholder="Topic name"
                                    className="h-8 text-sm"
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  className="h-8"
                                  onClick={() => addTopicMutation.mutate({ chapterId: chapter.id, ...newTopic })}
                                  disabled={!newTopic.name || addTopicMutation.isPending}
                                >
                                  Add
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8" onClick={() => setAddTopicOpen(null)}>Cancel</Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs text-gray-400 hover:text-blue-600"
                                onClick={() => setAddTopicOpen(chapter.id)}
                              >
                                <Plus className="w-3 h-3 mr-1" /> Add Topic
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="px-8 py-2 border-t">
                    {addChapterOpen === subject.id ? (
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Input
                            value={newChapter.name}
                            onChange={(e) => setNewChapter({ name: e.target.value })}
                            placeholder="Chapter name"
                            className="h-8 text-sm"
                          />
                        </div>
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => addChapterMutation.mutate({ subjectId: subject.id, name: newChapter.name })}
                          disabled={!newChapter.name || addChapterMutation.isPending}
                        >
                          Add
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8" onClick={() => setAddChapterOpen(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-gray-400 hover:text-blue-600"
                        onClick={() => setAddChapterOpen(subject.id)}
                      >
                        <Plus className="w-3 h-3 mr-1" /> Add Chapter
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
