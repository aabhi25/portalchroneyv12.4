import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Library,
  FileQuestion,
  Video,
  StickyNote,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Languages,
  Loader2,
  Search,
  ExternalLink,
  X,
  Inbox,
  AlertTriangle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import DOMPurify from "dompurify";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ContentTypeKey = "question" | "transcript" | "note" | "ebook_page";

interface Pack {
  cpId: string;
  label: string;
  cpName: string | null;
  board: string | null;
  medium: string | null;
  grade: string | null;
  subject: string | null;
  status: string | null;
  lastSyncedAt: string | null;
  counts: Record<ContentTypeKey, number>;
  total: number;
}

interface ChapterRow {
  chapter: string | null;
  contentType: string;
  count: number;
}

interface ChunkItem {
  id: string;
  contentType: string;
  chapter: string | null;
  title: string | null;
  contentHtml: string | null;
  contentText: string;
  sourceRef: string | null;
  mediaUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface ChunkPage {
  items: ChunkItem[];
  total: number;
  page: number;
  pageSize: number;
}

const TYPE_ORDER: ContentTypeKey[] = ["question", "transcript", "note", "ebook_page"];
const PAGE_SIZE = 50;
const NULL_CHAPTER = "__none__";

const TYPE_META: Record<
  ContentTypeKey,
  { label: string; singular: string; icon: typeof FileQuestion; active: string; chip: string }
> = {
  question: {
    label: "Questions",
    singular: "question",
    icon: FileQuestion,
    active: "bg-blue-600 text-white shadow-sm",
    chip: "bg-blue-50 text-blue-700 border-blue-200",
  },
  transcript: {
    label: "Video Transcripts",
    singular: "transcript",
    icon: Video,
    active: "bg-rose-600 text-white shadow-sm",
    chip: "bg-rose-50 text-rose-700 border-rose-200",
  },
  note: {
    label: "Notes",
    singular: "note",
    icon: StickyNote,
    active: "bg-amber-600 text-white shadow-sm",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
  },
  ebook_page: {
    label: "eBook Pages",
    singular: "page",
    icon: BookOpen,
    active: "bg-emerald-600 text-white shadow-sm",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
};

function decodeEntities(input: string): string {
  if (!input) return "";
  if (typeof document === "undefined") return input;
  const el = document.createElement("textarea");
  el.innerHTML = input;
  return el.value;
}

// Decodes entities AND strips tags — used to measure length and to render a
// plain-text fallback when the source is HTML.
function htmlToPlain(input: string): string {
  if (!input) return "";
  if (typeof document === "undefined") return input;
  const el = document.createElement("div");
  el.innerHTML = input;
  return (el.textContent || "").trim();
}

function looksLikeHtml(s: string): boolean {
  return /<[a-z!/][\s\S]*>/i.test(s);
}

function extractImages(metadata: Record<string, unknown> | null | undefined): string[] {
  const imgs = (metadata as any)?.images;
  if (Array.isArray(imgs)) {
    return imgs
      .map((x) => (typeof x === "string" ? x : x?.url || x?.src))
      .filter((u: unknown): u is string => typeof u === "string" && !!u);
  }
  return [];
}

// The answer/explanation for a question lives in metadata.solution as CMS HTML.
function getSolutionHtml(metadata: Record<string, unknown> | null | undefined): string {
  const s = (metadata as any)?.solution;
  return typeof s === "string" ? s.trim() : "";
}

// Multiple-choice options (currently empty in synced data, handled defensively).
function getOptions(metadata: Record<string, unknown> | null | undefined): string[] {
  const opts = (metadata as any)?.options;
  if (!Array.isArray(opts)) return [];
  return opts
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") return x.text || x.option || x.value || x.label || "";
      return "";
    })
    .filter((v: unknown): v is string => typeof v === "string" && !!v.trim());
}

function getDifficulty(metadata: Record<string, unknown> | null | undefined): number | null {
  const d = (metadata as any)?.difficulty;
  if (typeof d === "number" && Number.isFinite(d)) return d;
  if (typeof d === "string" && d.trim() !== "" && !Number.isNaN(Number(d))) return Number(d);
  return null;
}

// Transcript video length, stored as seconds in metadata.duration → mm:ss / h:mm:ss.
function formatDuration(metadata: Record<string, unknown> | null | undefined): string | null {
  const raw = (metadata as any)?.duration;
  const secs = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(secs) || secs <= 0) return null;
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function statusBadge(status: string | null) {
  if (status === "syncing") {
    return (
      <Badge variant="secondary" className="text-[10px] gap-1 bg-blue-50 text-blue-700 border-blue-200">
        <Loader2 className="w-3 h-3 animate-spin" /> Syncing
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="text-[10px]">
        Sync failed
      </Badge>
    );
  }
  return null;
}

// --- Board → Medium → Class grouping --------------------------------------
// All grouping is derived client-side from the already-fetched packs (each pack
// carries board/medium/grade), so no API/endpoint/DB change is involved.

const UNCLASSIFIED = "__unclassified__";

interface ClassGroup {
  key: string;
  grade: string;
  packs: Pack[];
  itemTotal: number;
}
interface MediumGroup {
  key: string;
  medium: string;
  classes: ClassGroup[];
  packCount: number;
  itemTotal: number;
}
interface BoardGroup {
  key: string;
  board: string;
  mediums: MediumGroup[];
  packCount: number;
  itemTotal: number;
}

interface SectionHandlers {
  isOpen: (key: string) => boolean;
  onToggle: (key: string) => void;
  onSelect: (pack: Pack) => void;
  onDelete: (pack: Pack) => void;
  deletingCpId: string | null;
}

// Sort grades numerically when possible ("2" < "10"), falling back to the end.
function gradeSortValue(grade: string): number {
  const m = grade.match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
}

// Build the Board → Medium → Class tree. Any pack missing a board, medium, or
// grade is routed to a flat "Unclassified" bucket so nothing is ever hidden.
function buildContentTree(packs: Pack[]): { boards: BoardGroup[]; unclassified: Pack[] } {
  const unclassified: Pack[] = [];
  const boardMap = new Map<string, Map<string, Map<string, Pack[]>>>();

  for (const pack of packs) {
    if (!pack.board || !pack.medium || !pack.grade) {
      unclassified.push(pack);
      continue;
    }
    let mediumMap = boardMap.get(pack.board);
    if (!mediumMap) {
      mediumMap = new Map();
      boardMap.set(pack.board, mediumMap);
    }
    let classMap = mediumMap.get(pack.medium);
    if (!classMap) {
      classMap = new Map();
      mediumMap.set(pack.medium, classMap);
    }
    let list = classMap.get(pack.grade);
    if (!list) {
      list = [];
      classMap.set(pack.grade, list);
    }
    list.push(pack);
  }

  const boards: BoardGroup[] = Array.from(boardMap.entries())
    .map(([board, mediumMap]) => {
      const mediums: MediumGroup[] = Array.from(mediumMap.entries())
        .map(([medium, classMap]) => {
          const classes: ClassGroup[] = Array.from(classMap.entries())
            .map(([grade, list]) => {
              const sorted = [...list].sort((a, b) => a.label.localeCompare(b.label));
              return {
                key: `${board}|||${medium}|||${grade}`,
                grade,
                packs: sorted,
                itemTotal: sorted.reduce((s, p) => s + p.total, 0),
              };
            })
            .sort(
              (a, b) =>
                gradeSortValue(a.grade) - gradeSortValue(b.grade) ||
                a.grade.localeCompare(b.grade),
            );
          return {
            key: `${board}|||${medium}`,
            medium,
            classes,
            packCount: classes.reduce((s, c) => s + c.packs.length, 0),
            itemTotal: classes.reduce((s, c) => s + c.itemTotal, 0),
          };
        })
        .sort((a, b) => a.medium.localeCompare(b.medium));
      return {
        key: board,
        board,
        mediums,
        packCount: mediums.reduce((s, m) => s + m.packCount, 0),
        itemTotal: mediums.reduce((s, m) => s + m.itemTotal, 0),
      };
    })
    .sort((a, b) => a.board.localeCompare(b.board));

  return { boards, unclassified };
}

export default function TopScholarContent() {
  const [selectedCpId, setSelectedCpId] = useState<string | null>(null);
  const [deletingCpId, setDeletingCpId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery<{ packs: Pack[] }>({
    queryKey: ["/api/topscholar/content/overview"],
  });

  const packs = data?.packs || [];
  const selectedPack = packs.find((p) => p.cpId === selectedCpId) || null;

  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Curriculum scope — cascading Board → Medium → Grade → Subject selects
  // (same behavior as the Testing page: each level narrows the next, changing
  // an upstream select resets everything below it). Vocabulary is derived from
  // the already-fetched packs, so it works for both pgvector and Mongo stores.
  const [scopeBoard, setScopeBoard] = useState("");
  const [scopeMedium, setScopeMedium] = useState("");
  const [scopeGrade, setScopeGrade] = useState("");
  const [scopeSubject, setScopeSubject] = useState("");

  const handleScopeBoardChange = (v: string) => {
    setScopeBoard(v);
    setScopeMedium("");
    setScopeGrade("");
    setScopeSubject("");
  };
  const handleScopeMediumChange = (v: string) => {
    setScopeMedium(v);
    setScopeGrade("");
    setScopeSubject("");
  };
  const handleScopeGradeChange = (v: string) => {
    setScopeGrade(v);
    setScopeSubject("");
  };
  const clearScope = () => {
    setScopeBoard("");
    setScopeMedium("");
    setScopeGrade("");
    setScopeSubject("");
  };

  const boardOptions = useMemo(
    () => Array.from(new Set(packs.map((p) => p.board).filter((v): v is string => !!v))).sort(),
    [packs],
  );
  const mediumOptions = useMemo(
    () =>
      Array.from(
        new Set(
          packs
            .filter((p) => !scopeBoard || p.board === scopeBoard)
            .map((p) => p.medium)
            .filter((v): v is string => !!v),
        ),
      ).sort(),
    [packs, scopeBoard],
  );
  const gradeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          packs
            .filter(
              (p) =>
                (!scopeBoard || p.board === scopeBoard) &&
                (!scopeMedium || p.medium === scopeMedium),
            )
            .map((p) => p.grade)
            .filter((v): v is string => !!v),
        ),
      ).sort((a, b) => gradeSortValue(a) - gradeSortValue(b) || a.localeCompare(b)),
    [packs, scopeBoard, scopeMedium],
  );
  const subjectOptions = useMemo(
    () =>
      Array.from(
        new Set(
          packs
            .filter(
              (p) =>
                (!scopeBoard || p.board === scopeBoard) &&
                (!scopeMedium || p.medium === scopeMedium) &&
                (!scopeGrade || p.grade === scopeGrade),
            )
            .map((p) => p.subject)
            .filter((v): v is string => !!v),
        ),
      ).sort(),
    [packs, scopeBoard, scopeMedium, scopeGrade],
  );

  const scopeActive = !!(scopeBoard || scopeMedium || scopeGrade || scopeSubject);
  const filterActive = filter.trim().length > 0 || scopeActive;

  const filteredPacks = useMemo(() => {
    let list = packs;
    if (scopeBoard) list = list.filter((p) => p.board === scopeBoard);
    if (scopeMedium) list = list.filter((p) => p.medium === scopeMedium);
    if (scopeGrade) list = list.filter((p) => p.grade === scopeGrade);
    if (scopeSubject) list = list.filter((p) => p.subject === scopeSubject);
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      [p.label, p.board, p.medium, p.grade, p.subject].some(
        (v) => typeof v === "string" && v.toLowerCase().includes(q),
      ),
    );
  }, [packs, filter, scopeBoard, scopeMedium, scopeGrade, scopeSubject]);

  const { boards, unclassified } = useMemo(
    () => buildContentTree(filteredPacks),
    [filteredPacks],
  );

  const allGroupKeys = useMemo(() => {
    const keys: string[] = [];
    for (const b of boards) {
      keys.push(b.key);
      for (const m of b.mediums) {
        keys.push(m.key);
        for (const c of m.classes) keys.push(c.key);
      }
    }
    if (unclassified.length > 0) keys.push(UNCLASSIFIED);
    return keys;
  }, [boards, unclassified]);

  // While a filter is active, force every group open so matches are always visible.
  const isOpen = (key: string) => filterActive || !collapsed.has(key);
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allGroupKeys));

  const deleteContent = useMutation({
    mutationFn: (cpId: string) => apiRequest("POST", "/api/topscholar/content/delete-cp", { cpId }),
    onSuccess: (_data, cpId) => {
      toast({ title: "Content deleted", description: "The chatbot will no longer use this content pack." });
      // Leave the detail view if we just deleted the pack we were viewing.
      if (selectedCpId === cpId) setSelectedCpId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/topscholar/content/overview"] });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
    onSettled: () => setDeletingCpId(null),
  });

  // Confirm-then-delete a whole content pack (all extracted/embedded chunks for a cp_id).
  const requestDelete = (pack: Pack) => {
    const ok = window.confirm(
      `Delete all extracted content for "${pack.label}"?\n\nThis permanently removes every embedded note, transcript, and question for this content pack and the chatbot will immediately stop using it. This cannot be undone.`,
    );
    if (!ok) return;
    setDeletingCpId(pack.cpId);
    deleteContent.mutate(pack.cpId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertTriangle className="w-12 h-12 text-amber-400 mb-3" />
            <h3 className="text-base font-semibold text-gray-700">Couldn't load content</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-md">{(error as Error).message}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedPack) {
    return (
      <PackDetail
        pack={selectedPack}
        onBack={() => setSelectedCpId(null)}
        onDelete={() => requestDelete(selectedPack)}
        deleting={deletingCpId === selectedPack.cpId}
      />
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Library className="w-6 h-6 text-cyan-600" />
            Ext. Content
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Browse all extracted curriculum content synced from the TopScholar content store. Read-only.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {packs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="w-14 h-14 text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-700">No content yet</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-md">
              Once a content pack has been synced from the TopScholar content store, its extracted questions,
              transcripts, and notes will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {boardOptions.length > 0 && (
            <Card>
              <CardContent className="py-4 px-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-700">Curriculum scope</span>
                  {scopeActive && (
                    <button
                      onClick={clearScope}
                      className="text-xs font-medium text-cyan-600 hover:text-cyan-700 flex items-center gap-1"
                      data-testid="button-clear-scope"
                    >
                      <X className="w-3.5 h-3.5" /> Clear
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Board</label>
                    <Select value={scopeBoard} onValueChange={handleScopeBoardChange}>
                      <SelectTrigger data-testid="select-scope-board">
                        <SelectValue placeholder="Select a board" />
                      </SelectTrigger>
                      <SelectContent>
                        {boardOptions.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Medium</label>
                    <Select
                      value={scopeMedium}
                      onValueChange={handleScopeMediumChange}
                      disabled={!scopeBoard}
                    >
                      <SelectTrigger data-testid="select-scope-medium">
                        <SelectValue placeholder="Select a medium" />
                      </SelectTrigger>
                      <SelectContent>
                        {mediumOptions.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Grade</label>
                    <Select
                      value={scopeGrade}
                      onValueChange={handleScopeGradeChange}
                      disabled={!scopeBoard || !scopeMedium}
                    >
                      <SelectTrigger data-testid="select-scope-grade">
                        <SelectValue placeholder="Select a grade" />
                      </SelectTrigger>
                      <SelectContent>
                        {gradeOptions.map((g) => (
                          <SelectItem key={g} value={g}>
                            {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Subject</label>
                    <Select
                      value={scopeSubject}
                      onValueChange={setScopeSubject}
                      disabled={!scopeBoard || !scopeMedium || !scopeGrade || subjectOptions.length === 0}
                    >
                      <SelectTrigger data-testid="select-scope-subject">
                        <SelectValue
                          placeholder={
                            scopeBoard && scopeMedium && scopeGrade && subjectOptions.length === 0
                              ? "No subjects available"
                              : "Select a subject"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {subjectOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by board, medium, class, or subject…"
                className="pl-9 bg-white"
                data-testid="input-filter"
              />
              {filter && (
                <button
                  onClick={() => setFilter("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Clear filter"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={expandAll}
                disabled={filterActive}
                data-testid="button-expand-all"
              >
                Expand all
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={collapseAll}
                disabled={filterActive}
                data-testid="button-collapse-all"
              >
                Collapse all
              </Button>
            </div>
          </div>

          {boards.length === 0 && unclassified.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="w-10 h-10 text-gray-300 mb-3" />
                <h3 className="text-base font-semibold text-gray-600">Nothing matches</h3>
                <p className="text-sm text-gray-400 mt-1">Try a different board, class, or subject.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {boards.map((board) => (
                <BoardSection
                  key={board.key}
                  board={board}
                  isOpen={isOpen}
                  onToggle={toggle}
                  onSelect={(pack) => setSelectedCpId(pack.cpId)}
                  onDelete={requestDelete}
                  deletingCpId={deletingCpId}
                />
              ))}
              {unclassified.length > 0 && (
                <UnclassifiedSection
                  packs={unclassified}
                  isOpen={isOpen}
                  onToggle={toggle}
                  onSelect={(pack) => setSelectedCpId(pack.cpId)}
                  onDelete={requestDelete}
                  deletingCpId={deletingCpId}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BoardSection({
  board,
  isOpen,
  onToggle,
  onSelect,
  onDelete,
  deletingCpId,
}: { board: BoardGroup } & SectionHandlers) {
  const open = isOpen(board.key);
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => onToggle(board.key)}
        data-testid={`board-${board.key}`}
      >
        {open ? (
          <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />
        )}
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shrink-0">
          <Library className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-bold text-lg">{board.board}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="secondary" className="text-[11px]">
            {board.packCount} pack{board.packCount === 1 ? "" : "s"}
          </Badge>
          {board.itemTotal > 0 && (
            <Badge variant="outline" className="text-[11px] hidden sm:inline-flex">
              {board.itemTotal.toLocaleString()} items
            </Badge>
          )}
        </div>
      </button>
      {open && (
        <div className="border-t bg-gray-50/40 p-3 space-y-2">
          {board.mediums.map((medium) => (
            <MediumSection
              key={medium.key}
              medium={medium}
              isOpen={isOpen}
              onToggle={onToggle}
              onSelect={onSelect}
              onDelete={onDelete}
              deletingCpId={deletingCpId}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function MediumSection({
  medium,
  isOpen,
  onToggle,
  onSelect,
  onDelete,
  deletingCpId,
}: { medium: MediumGroup } & SectionHandlers) {
  const open = isOpen(medium.key);
  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
        onClick={() => onToggle(medium.key)}
        data-testid={`medium-${medium.key}`}
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
        )}
        <Languages className="w-4 h-4 text-cyan-600 shrink-0" />
        <span className="font-semibold text-sm">{medium.medium}</span>
        <span className="text-xs text-gray-400">medium</span>
        <span className="ml-auto text-xs text-gray-500">
          {medium.packCount} pack{medium.packCount === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <div className="px-2 pb-2 pt-2 space-y-2 border-t">
          {medium.classes.map((cls) => (
            <ClassSection
              key={cls.key}
              cls={cls}
              isOpen={isOpen}
              onToggle={onToggle}
              onSelect={onSelect}
              onDelete={onDelete}
              deletingCpId={deletingCpId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClassSection({
  cls,
  isOpen,
  onToggle,
  onSelect,
  onDelete,
  deletingCpId,
}: { cls: ClassGroup } & SectionHandlers) {
  const open = isOpen(cls.key);
  return (
    <div>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-md hover:bg-gray-50 transition-colors"
        onClick={() => onToggle(cls.key)}
        data-testid={`class-${cls.key}`}
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {/^\d/.test(cls.grade) ? `Class ${cls.grade}` : cls.grade}
        </span>
        <span className="ml-auto text-[11px] text-gray-400">
          {cls.packs.length} subject{cls.packs.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <div className="pl-3 sm:pl-6 pr-0.5 pb-1 pt-1 space-y-2">
          {cls.packs.map((pack) => (
            <PackCard
              key={pack.cpId}
              pack={pack}
              onSelect={() => onSelect(pack)}
              onDelete={() => onDelete(pack)}
              deleting={deletingCpId === pack.cpId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UnclassifiedSection({
  packs,
  isOpen,
  onToggle,
  onSelect,
  onDelete,
  deletingCpId,
}: { packs: Pack[] } & SectionHandlers) {
  const open = isOpen(UNCLASSIFIED);
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
        onClick={() => onToggle(UNCLASSIFIED)}
        data-testid="board-unclassified"
      >
        {open ? (
          <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-400 shrink-0" />
        )}
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-100 shrink-0">
          <AlertTriangle className="w-5 h-5 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-bold text-lg">Unclassified</span>
          <p className="text-xs text-gray-500">Missing a board, medium, or class</p>
        </div>
        <Badge variant="secondary" className="text-[11px] shrink-0">
          {packs.length} pack{packs.length === 1 ? "" : "s"}
        </Badge>
      </button>
      {open && (
        <div className="border-t bg-gray-50/40 p-3 space-y-2">
          {packs.map((pack) => (
            <PackCard
              key={pack.cpId}
              pack={pack}
              onSelect={() => onSelect(pack)}
              onDelete={() => onDelete(pack)}
              deleting={deletingCpId === pack.cpId}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function PackCard({
  pack,
  onSelect,
  onDelete,
  deleting,
}: {
  pack: Pack;
  onSelect: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const triple = [pack.board, pack.medium, pack.grade].filter(Boolean) as string[];
  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow">
      <div className="flex items-stretch">
      <button
        className="flex-1 min-w-0 text-left flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors"
        onClick={onSelect}
        data-testid={`pack-${pack.cpId}`}
      >
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shrink-0">
          <Library className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{pack.label}</span>
            {statusBadge(pack.status)}
          </div>
          {triple.length > 0 && (
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {triple.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {TYPE_ORDER.filter((t) => pack.counts[t] > 0).map((t) => {
              const Icon = TYPE_META[t].icon;
              return (
                <span
                  key={t}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${TYPE_META[t].chip}`}
                >
                  <Icon className="w-3 h-3" />
                  {pack.counts[t].toLocaleString()} {TYPE_META[t].label}
                </span>
              );
            })}
            {pack.total === 0 && (
              <span className="text-xs text-gray-400">
                {pack.status === "syncing" ? "Sync in progress…" : "No extracted content"}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />
      </button>
        <div className="flex items-center pr-3 pl-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={onDelete}
            disabled={deleting}
            title="Delete content"
            data-testid={`delete-pack-${pack.cpId}`}
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PackDetail({
  pack,
  onBack,
  onDelete,
  deleting,
}: {
  pack: Pack;
  onBack: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const availableTypes = TYPE_ORDER.filter((t) => pack.counts[t] > 0);
  const [activeType, setActiveType] = useState<ContentTypeKey>(availableTypes[0] || "question");
  const [chapter, setChapter] = useState<string>(""); // "" = all, NULL_CHAPTER = null, else exact
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 400);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    setChapter("");
  }, [activeType]);

  useEffect(() => {
    setPage(1);
  }, [activeType, chapter, q]);

  const { data: chaptersData } = useQuery<{ chapters: ChapterRow[] }>({
    queryKey: [`/api/topscholar/content/chapters?cpId=${encodeURIComponent(pack.cpId)}`],
  });

  const chapterOptions = useMemo(() => {
    const rows = (chaptersData?.chapters || []).filter((c) => c.contentType === activeType);
    return rows
      .map((c) => ({
        value: c.chapter === null ? NULL_CHAPTER : c.chapter,
        label: c.chapter || "(No chapter)",
        count: c.count,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [chaptersData, activeType]);

  const chunksUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("cpId", pack.cpId);
    params.set("contentType", activeType);
    if (chapter) params.set("chapter", chapter);
    if (q) params.set("q", q);
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    return `/api/topscholar/content/chunks?${params.toString()}`;
  }, [pack.cpId, activeType, chapter, q, page]);

  const { data: chunkData, isFetching: chunksFetching } = useQuery<ChunkPage>({
    queryKey: [chunksUrl],
    enabled: availableTypes.length > 0,
  });

  const total = chunkData?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = chunkData?.items || [];

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const triple = [pack.board, pack.medium, pack.grade].filter(Boolean) as string[];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        data-testid="button-back"
      >
        <ChevronLeft className="w-4 h-4" /> All content packs
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Library className="w-6 h-6 text-cyan-600" />
            {pack.label}
          </h1>
          <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
            {triple.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                {t}
              </Badge>
            ))}
            {statusBadge(pack.status)}
            <span className="text-xs text-gray-400 font-mono">{pack.cpId}</span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 h-9 gap-1.5 text-red-600 border-red-200 hover:text-red-700 hover:bg-red-50"
          onClick={onDelete}
          disabled={deleting}
          data-testid={`delete-pack-detail-${pack.cpId}`}
        >
          {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          Delete content
        </Button>
      </div>

      {availableTypes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="w-12 h-12 text-gray-300 mb-3" />
            <h3 className="text-base font-semibold text-gray-700">No extracted content</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-md">
              {pack.status === "syncing"
                ? "This pack is still syncing. Check back once the sync completes."
                : "This content pack has no extracted chunks yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Content type tabs */}
          <div className="flex flex-wrap gap-1.5">
            {availableTypes.map((t) => {
              const Icon = TYPE_META[t].icon;
              const isActive = activeType === t;
              return (
                <button
                  key={t}
                  onClick={() => setActiveType(t)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    isActive
                      ? TYPE_META[t].active
                      : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300"
                  }`}
                  data-testid={`tab-${t}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {TYPE_META[t].label}
                  <span className={isActive ? "opacity-80" : "text-gray-400"}>
                    {pack.counts[t].toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Filters */}
          <Card className="bg-gradient-to-r from-slate-50 to-gray-50 border-gray-200">
            <CardContent className="py-4 px-5 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                  placeholder={`Search ${TYPE_META[activeType].label.toLowerCase()}…`}
                  className="pl-9 bg-white"
                  data-testid="input-search"
                />
                {qInput && (
                  <button
                    onClick={() => setQInput("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {chapterOptions.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Chapter</label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setChapter("")}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        !chapter
                          ? "bg-cyan-600 text-white shadow-sm"
                          : "bg-white text-gray-600 border border-gray-200 hover:border-cyan-300 hover:text-cyan-600"
                      }`}
                    >
                      All chapters
                    </button>
                    {chapterOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setChapter(opt.value)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                          chapter === opt.value
                            ? "bg-cyan-600 text-white shadow-sm"
                            : "bg-white text-gray-600 border border-gray-200 hover:border-cyan-300 hover:text-cyan-600"
                        }`}
                      >
                        {opt.label}
                        <span className={chapter === opt.value ? "opacity-80 ml-1" : "text-gray-400 ml-1"}>
                          {opt.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Results */}
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>
              {chunksFetching ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                </span>
              ) : (
                `${total.toLocaleString()} ${TYPE_META[activeType].singular}${total !== 1 ? "s" : ""}`
              )}
            </span>
            {totalPages > 1 && (
              <span>
                Page {page} of {totalPages}
              </span>
            )}
          </div>

          {items.length === 0 && !chunksFetching ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="w-10 h-10 text-gray-300 mb-3" />
                <h3 className="text-base font-semibold text-gray-600">Nothing matches</h3>
                <p className="text-sm text-gray-400 mt-1">Try a different chapter or search term.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <ContentItemCard
                  key={item.id}
                  item={item}
                  expanded={expanded.has(item.id)}
                  onToggle={() => toggleExpand(item.id)}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || chunksFetching}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                data-testid="button-prev"
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </Button>
              <span className="text-sm text-gray-500 px-2">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || chunksFetching}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                data-testid="button-next"
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ContentItemCard({
  item,
  expanded,
  onToggle,
}: {
  item: ChunkItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const images = extractImages(item.metadata);
  const isTranscript = item.contentType === "transcript";
  const isQuestion = item.contentType === "question";
  const [showAnswer, setShowAnswer] = useState(false);

  const solutionHtml = isQuestion ? getSolutionHtml(item.metadata) : "";
  const options = isQuestion ? getOptions(item.metadata) : [];
  const difficulty = isQuestion ? getDifficulty(item.metadata) : null;
  const duration = isTranscript ? formatDuration(item.metadata) : null;

  // content_html is preferred when present; otherwise content_text — which is
  // itself sometimes HTML (e.g. questions) and sometimes plain (e.g. notes).
  const rawHtml = (item.contentHtml || "").trim();
  const rawText = item.contentText || "";
  const htmlSource = rawHtml || (looksLikeHtml(rawText) ? rawText : "");
  const isHtml = !!htmlSource;
  // Synced CMS HTML is third-party content — sanitize before rendering to block
  // stored-XSS vectors like <img onerror> / <svg onload>.
  const safeHtml = useMemo(() => (isHtml ? DOMPurify.sanitize(htmlSource) : ""), [isHtml, htmlSource]);
  // Solution/answer is third-party CMS HTML — sanitize before rendering.
  const safeSolution = useMemo(
    () => (solutionHtml ? DOMPurify.sanitize(solutionHtml) : ""),
    [solutionHtml],
  );
  const plain = isHtml ? htmlToPlain(safeHtml) : decodeEntities(rawText);
  const longContent = plain.length > 600;
  const showFull = expanded || !longContent;
  const displayText = showFull ? plain : `${plain.slice(0, 600)}…`;

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            {item.title && <div className="font-medium text-sm">{decodeEntities(item.title)}</div>}
            <div className="flex gap-1.5 mt-1 flex-wrap items-center">
              {item.chapter && (
                <Badge variant="secondary" className="text-[10px]">
                  {item.chapter}
                </Badge>
              )}
              {difficulty !== null && (
                <Badge variant="outline" className="text-[10px]">
                  Difficulty {difficulty}
                </Badge>
              )}
              {duration && (
                <Badge variant="outline" className="text-[10px]">
                  {duration}
                </Badge>
              )}
              {item.sourceRef && (
                <span className="text-[10px] text-gray-400 font-mono">ref: {item.sourceRef}</span>
              )}
            </div>
          </div>
          {isTranscript && item.mediaUrl && (
            <a href={item.mediaUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
              <Button variant="outline" size="sm" className="h-8">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Media
              </Button>
            </a>
          )}
        </div>

        {isHtml
          ? plain && (
              <div
                className={`ts-rich-content text-sm text-gray-700 break-words leading-relaxed ${
                  showFull ? "" : "max-h-40 overflow-hidden"
                }`}
                dangerouslySetInnerHTML={{ __html: safeHtml }}
              />
            )
          : plain && (
              <p className="text-sm text-gray-700 whitespace-pre-wrap break-words leading-relaxed">
                {displayText}
              </p>
            )}

        {longContent && (
          <button
            onClick={onToggle}
            className="text-xs font-medium text-cyan-600 hover:text-cyan-700"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}

        {isQuestion && options.length > 0 && (
          <ul className="space-y-1 pt-1">
            {options.map((opt, idx) => (
              <li key={idx} className="flex gap-2 text-sm text-gray-700">
                <span className="text-gray-400 shrink-0">{String.fromCharCode(65 + idx)}.</span>
                {looksLikeHtml(opt) ? (
                  <span
                    className="ts-rich-content break-words"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(opt) }}
                  />
                ) : (
                  <span className="break-words">{decodeEntities(opt)}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {isQuestion && safeSolution && (
          <div className="pt-1">
            <button
              onClick={() => setShowAnswer((v) => !v)}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              {showAnswer ? "Hide answer" : "Show answer"}
            </button>
            {showAnswer && (
              <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  Answer
                </div>
                <div
                  className="ts-rich-content text-sm text-gray-700 break-words leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: safeSolution }}
                />
              </div>
            )}
          </div>
        )}

        {!isTranscript && item.mediaUrl && (
          <a
            href={item.mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-cyan-600 hover:text-cyan-700"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open media
          </a>
        )}

        {images.length > 0 && (
          <div className="flex gap-2 flex-wrap pt-1">
            {images.map((src, idx) => (
              <a key={idx} href={src} target="_blank" rel="noopener noreferrer">
                <img
                  src={src}
                  alt={`figure ${idx + 1}`}
                  loading="lazy"
                  className="h-20 w-auto rounded border border-gray-200 object-cover hover:opacity-90 transition-opacity"
                />
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
