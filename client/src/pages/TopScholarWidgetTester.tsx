import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Redirect } from "wouter";
import type { MeResponseDto } from "@shared/dto";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GraduationCap,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  RotateCcw,
  Radio,
  XCircle,
  Plug,
  Unplug,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getPublicWidgetOrigin } from "@/lib/deploymentUrls";

  // One distinct board/medium/grade combination physically present in the active
  // client content store, plus the content packs (cp_ids) it contains.
interface SubjectOption {
  name: string;
  cpCount: number;
}

interface ScopeOption {
  board: string;
  medium: string;
  grade: string;
  label: string;
  cpCount: number;
  subjects: SubjectOption[];
}

// Uses the current deployment host unless an explicit public widget origin is
// configured for the build.
const WIDGET_DOMAIN = getPublicWidgetOrigin();

export default function TopScholarWidgetTester() {
  const { toast } = useToast();
  const [board, setBoard] = useState<string>("");
  const [medium, setMedium] = useState<string>("");
  const [grade, setGrade] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [chapter, setChapter] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const { data: me, isLoading: meLoading } = useQuery<MeResponseDto>({
    queryKey: ["/api/auth/me"],
  });

  const isTopscholar = me?.businessAccount?.isTopscholar === true;
  const businessAccountId = me?.businessAccount?.id ?? "";

  // Simulate a doubt-scoped session in the preview so the "Did this resolve your
  // doubt?" prompt can be tested without a real portal-launched doubt. Purely a
  // client-side simulation — no portal call, no ticket.
  const [simulateDoubt, setSimulateDoubt] = useState(false);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Live end-to-end test: the server mints a REAL signed launch token from the
  // test IDs below, so the widget runs the exact production doubt path — messages
  // sync to the client's portal, the retry-once flow is real, and the second "No"
  // creates a real ticket AND fires the client's escalation email. Nothing here
  // is simulated; use test IDs the client is okay with.
  const [liveStudentId, setLiveStudentId] = useState("");
  const [livePlanId, setLivePlanId] = useState("");
  const [liveDoubtId, setLiveDoubtId] = useState("");
  const [liveName, setLiveName] = useState("");
  const [liveToken, setLiveToken] = useState("");
  const [liveActiveDoubtId, setLiveActiveDoubtId] = useState("");
  const [isMinting, setIsMinting] = useState(false);

  // Raw-token tester: paste any token from the client, load this deployment's widget
  const [rawToken, setRawToken] = useState("");
  const [widgetInjected, setWidgetInjected] = useState(false);
  const widgetScriptRef = useRef<HTMLScriptElement | null>(null);

  const handleLoadWidget = () => {
    handleRemoveWidget();
    const script = document.createElement("script");
    script.src = `${WIDGET_DOMAIN}/widget-loader.js`;
    script.setAttribute("data-business-id", businessAccountId || "1e80bae7-e219-4769-824d-ee027770cd7d");
    script.setAttribute("data-token", rawToken.trim());
    script.setAttribute("data-aichroney-tester", "1");
    document.body.appendChild(script);
    widgetScriptRef.current = script;
    setWidgetInjected(true);
  };

  const handleRemoveWidget = () => {
    if (widgetScriptRef.current) {
      widgetScriptRef.current.remove();
      widgetScriptRef.current = null;
    }
    // Remove any elements widget.js injected into the page
    document.querySelectorAll(
      '[id^="aichroney-"], [class*="aichroney-widget"], [data-aichroney-tester]'
    ).forEach((el) => el.remove());
    setWidgetInjected(false);
  };

  const { data: options, isLoading, isError } = useQuery<ScopeOption[]>({
    queryKey: ["/api/topscholar/scope-options"],
    enabled: isTopscholar,
  });

  // Configured cooling period (idle seconds) before the doubt prompt fires. null =
  // platform default (120s). Surfaced so the preview timing matches production.
  const { data: tsConfig } = useQuery<{ doubtResolutionCooldownSeconds: number | null }>({
    queryKey: ["/api/topscholar/config"],
    enabled: isTopscholar,
  });
  const doubtCooldownSeconds = tsConfig?.doubtResolutionCooldownSeconds ?? 120;

  const opts = options ?? [];

  // Chapters available for the chosen board/medium/grade/subject, read from the
  // active client content store once a complete subject scope is selected.
  const baseScopeSelected = !!(board && medium && grade && subject);
  const { data: chapterData, isLoading: chaptersLoading } = useQuery<{ chapters: string[] }>({
    queryKey: ["/api/topscholar/scope-chapters", board, medium, grade, subject],
    queryFn: async () => {
      const params = new URLSearchParams({ board, medium, grade, subject });
      const res = await fetch(`/api/topscholar/scope-chapters?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load chapters");
      return res.json();
    },
    enabled: isTopscholar && baseScopeSelected,
  });
  const chapters = useMemo(() => chapterData?.chapters ?? [], [chapterData]);

  // Cascading dropdown vocabularies. Each level narrows to combos consistent with
  // the selections above it, so the admin can only build combos that actually exist.
  const boards = useMemo(
    () => Array.from(new Set(opts.map((o) => o.board).filter(Boolean))).sort(),
    [opts],
  );
  const mediums = useMemo(
    () =>
      Array.from(
        new Set(
          opts
            .filter((o) => !board || o.board === board)
            .map((o) => o.medium)
            .filter(Boolean),
        ),
      ).sort(),
    [opts, board],
  );
  const grades = useMemo(
    () =>
      Array.from(
        new Set(
          opts
            .filter((o) => (!board || o.board === board) && (!medium || o.medium === medium))
            .map((o) => o.grade)
            .filter(Boolean),
        ),
      ).sort(),
    [opts, board, medium],
  );

  // The exact combo (if any) the current full selection maps to.
  const selectedCombo = useMemo(() => {
    if (!board || !medium || !grade) return null;
    return (
      opts.find((o) => o.board === board && o.medium === medium && o.grade === grade) ?? null
    );
  }, [opts, board, medium, grade]);

  // Subjects available for the chosen board/medium/grade. Subject is REQUIRED — a
  // specific subject must be picked before the preview and embed snippet appear.
  const subjects = useMemo(() => selectedCombo?.subjects ?? [], [selectedCombo]);

  // Board + medium + grade chosen — enough to populate the subject dropdown.
  const hasBaseSelection = !!(board && medium && grade);
  // A complete, embeddable selection requires a subject AND a chapter (both
  // mandatory in the tester) so answers are scoped down to a single chapter.
  const hasFullSelection = hasBaseSelection && !!subject && !!chapter;

  // Preview launch identity. Voice refuses an unsigned widget session on a
  // TopScholar account, so the preview needs a genuinely signed token rather
  // than the plain scope params it used to load with — chat never went through
  // that check, which is why only voice was dead. Scope-only: it names no
  // student and binds to no doubt, so nothing reaches the client's system.
  // The result is stored WITH the scope it was signed for, and read back only
  // when that still matches the current selection. A signed token outranks the
  // URL's scope params on the server, so mounting the preview while a previous
  // scope's token sat in state would silently preview the wrong chapter. Keying
  // it invalidates the token during the same render as the scope change —
  // before the iframe can remount with it — which an effect cannot do, since
  // effects run after that render has already committed.
  const scopeKey = `${board}|${medium}|${grade}|${subject}|${chapter}`;
  const [signedPreview, setSignedPreview] = useState<{
    scopeKey: string;
    token: string;
    error: string;
  } | null>(null);
  const currentPreview = signedPreview?.scopeKey === scopeKey ? signedPreview : null;
  const previewToken = currentPreview?.token ?? "";
  const previewTokenError = currentPreview?.error ?? "";

  useEffect(() => {
    // Live mode brings its own token and wins.
    if (!hasFullSelection || !businessAccountId || liveToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/topscholar/tester/mint-launch-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ mode: "preview", board, medium, grade, subject, chapter }),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(json?.error || "Could not sign this preview session.");
        setSignedPreview({ scopeKey, token: json.token || "", error: "" });
      } catch (err) {
        if (cancelled) return;
        // Do not fall back to an unsigned scope here: the server may have rejected
        // a client-store scope that does not match the current live-widget mapping.
        setSignedPreview({
          scopeKey,
          token: "",
          error: err instanceof Error ? err.message : "Could not sign this preview session.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasFullSelection, businessAccountId, liveToken, scopeKey, board, medium, grade, subject, chapter]);

  // Match count for the selected subject's content pack.
  const selectedSubject = useMemo(
    () => (subject ? subjects.find((s) => s.name === subject) ?? null : null),
    [subjects, subject],
  );
  const matchCount = selectedSubject?.cpCount ?? 0;

  // Force the preview iframe to fully reload whenever the scope OR the doubt
  // simulation toggle changes (the flag is read once at widget mount). A live
  // token, when present, wins over the simulation: the widget is loaded exactly
  // as the client portal would launch it (signed token, no preview flags).
  const isLive = !!liveToken;
  const previewKey = `${board}|${medium}|${grade}|${subject}|${chapter}|${isLive ? `live:${liveToken.slice(-12)}` : simulateDoubt ? "doubt" : "plain"}|${previewToken.slice(-12)}`;
  // Hold the preview back until this scope's signing attempt has settled, so
  // the iframe mounts once with its final URL — never with a stale token, and
  // never reloading mid-conversation when the token lands.
  const previewUrl =
    !hasFullSelection || (!isLive && (!currentPreview || previewTokenError))
      ? ""
      : isLive
        ? `/embed/chat?businessAccountId=${encodeURIComponent(businessAccountId)}&token=${encodeURIComponent(liveToken)}`
        : `/embed/chat?businessAccountId=${encodeURIComponent(
            businessAccountId,
          )}&board=${encodeURIComponent(board)}&medium=${encodeURIComponent(
            medium,
          )}&grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(
            subject,
          )}&chapter=${encodeURIComponent(chapter)}${
            // The scope params stay for the widget's own client-side use; the
            // token is what authorizes voice.
            previewToken ? `&token=${encodeURIComponent(previewToken)}` : ""
          }${
            simulateDoubt
              ? `&previewDoubt=1&previewDoubtCooldown=${encodeURIComponent(String(doubtCooldownSeconds))}`
              : ""
          }`;

  // Poll the outbound sync activity while a live session is running so the admin
  // can watch messages / close / escalation email land on the client's system.
  interface SyncEvent {
    at: string;
    kind: "message" | "attachment" | "close" | "escalation_email";
    doubtId: string;
    ok: boolean;
    detail: string;
  }
  const { data: syncLog } = useQuery<{ events: SyncEvent[]; doubtSyncConfigured: boolean }>({
    queryKey: ["/api/topscholar/tester/doubt-sync-events", liveActiveDoubtId],
    queryFn: async () => {
      const res = await fetch(
        `/api/topscholar/tester/doubt-sync-events?doubtId=${encodeURIComponent(liveActiveDoubtId)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load sync activity");
      return res.json();
    },
    enabled: isTopscholar && isLive && !!liveActiveDoubtId,
    refetchInterval: 5000,
  });

  const handleStartLiveSession = async () => {
    if (!hasFullSelection) return;
    if (!liveStudentId.trim() || !liveDoubtId.trim()) {
      toast({
        title: "Student ID and Doubt ID are required",
        description: "Use test IDs from the client's system so the data lands in their test records.",
        variant: "destructive",
      });
      return;
    }
    setIsMinting(true);
    try {
      const res = await fetch("/api/topscholar/tester/mint-launch-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          board,
          medium,
          grade,
          subject,
          chapter,
          studentId: liveStudentId.trim(),
          planId: livePlanId.trim(),
          doubtId: liveDoubtId.trim(),
          name: liveName.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to start the live session");
      setLiveToken(json.token);
      setLiveActiveDoubtId(liveDoubtId.trim());
      setSimulateDoubt(false);
      toast({
        title: "Live session started",
        description: "This session now writes real data to the client's system.",
      });
    } catch (err) {
      toast({
        title: "Couldn't start live session",
        description: err instanceof Error ? err.message : "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setIsMinting(false);
    }
  };

  const handleEndLiveSession = () => {
    setLiveToken("");
    setLiveActiveDoubtId("");
  };

  // "Show prompt now": ask the embedded widget to reveal the doubt prompt
  // immediately (bypassing the cooldown). Only meaningful while simulating.
  const handleShowDoubtPromptNow = () => {
    previewIframeRef.current?.contentWindow?.postMessage(
      { type: "aichroney:preview-doubt-show" },
      window.location.origin,
    );
  };

  // Exact subject-scoped embed snippet for the current selection (real values, not
  // placeholders) so the admin can hand the right attributes to the client portal.
  // data-business-id is required by widget-loader.js; the scope attributes narrow
  // answers to this student's grade and chosen subject (all required).
  const embedSnippet = hasFullSelection
    ? `<!-- AI Chroney Widget (subject-scoped) -->
<!-- data-student-id + data-name attribute chats to the student (history across -->
<!-- devices, per-student reports). Have your portal fill these for each student. -->
<script src="${WIDGET_DOMAIN}/widget-loader.js" data-business-id="${businessAccountId}"
        data-board="${board}"
        data-medium="${medium}"
        data-grade="${grade}"
        data-subject="${subject}"
        data-chapter="${chapter}"
        data-student-id="{{ student.id }}"
        data-name="{{ student.name }}"></script>`
    : "";

  // Any scope change invalidates a running live session — the minted token is
  // bound to the old scope, so we always end the session rather than carry it.
  const handleBoardChange = (v: string) => {
    handleEndLiveSession();
    setBoard(v);
    setMedium("");
    setGrade("");
    setSubject("");
    setChapter("");
  };
  const handleMediumChange = (v: string) => {
    handleEndLiveSession();
    setMedium(v);
    setGrade("");
    setSubject("");
    setChapter("");
  };
  const handleGradeChange = (v: string) => {
    handleEndLiveSession();
    setGrade(v);
    setSubject("");
    setChapter("");
  };
  const handleSubjectChange = (v: string) => {
    handleEndLiveSession();
    setSubject(v);
    setChapter("");
  };
  const handleChapterChange = (v: string) => {
    handleEndLiveSession();
    setChapter(v);
  };

  const handleReset = () => {
    handleEndLiveSession();
    setBoard("");
    setMedium("");
    setGrade("");
    setSubject("");
    setChapter("");
  };

  const handleCopy = async () => {
    if (!embedSnippet) return;
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Embed snippet copied" });
    } catch {
      toast({ title: "Couldn't copy to clipboard", variant: "destructive" });
    }
  };

  // Client hard-gate: this page is TopScholar-only. Until /api/auth/me resolves
  // we wait; once resolved, any non-TopScholar account is redirected away so the
  // page is never directly reachable by URL for other tenants.
  if (meLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!isTopscholar) {
    return <Redirect to="/" />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center">
          <GraduationCap className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-tester-title">
            Widget Tester
          </h1>
          <p className="text-sm text-muted-foreground">
            Pick a board, medium, grade, subject, and chapter to chat with the chapter-scoped
            widget exactly as a student would. Confirm answers stay within the selected scope.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Raw token tester — paste a client-generated token and load the production widget */}
        <Card className="border-blue-200 dark:border-blue-900">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plug className="w-4 h-4 text-blue-600" />
              Raw Token Test
              {widgetInjected && (
                <Badge className="bg-blue-600 hover:bg-blue-600 text-white gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Widget active
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste a signed token from the client's portal and load the production widget directly on
              this page. The chatbot will appear in the <strong>bottom-right corner</strong> exactly as
              it does for their students — including any refusal message if the token is invalid.
            </p>
            <Textarea
              value={rawToken}
              onChange={(e) => setRawToken(e.target.value)}
              placeholder="Paste token here… e.g. eyJpYXQiOi..."
              className="font-mono text-xs h-20 resize-none"
              disabled={widgetInjected}
            />
            <div className="flex items-center gap-2">
              {!widgetInjected ? (
                <Button
                  onClick={handleLoadWidget}
                  disabled={!rawToken.trim()}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Plug className="w-4 h-4 mr-1" /> Load widget
                </Button>
              ) : (
                <Button variant="outline" onClick={handleRemoveWidget}>
                  <Unplug className="w-4 h-4 mr-1" /> Remove widget
                </Button>
              )}
              {widgetInjected && (
                <p className="text-xs text-muted-foreground">
                  Look for the chat bubble in the bottom-right corner of this page.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top: curriculum scope (full width) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Curriculum scope</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading client content scope…
              </div>
            ) : isError ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4" /> Failed to load client content scope.
              </div>
            ) : opts.length === 0 ? (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="w-4 h-4 mt-0.5" />
                <span>
                  No complete curriculum scope was found in the client content store yet. Sync
                  content with Board, Medium, Grade, Subject, and Chapter metadata first.
                </span>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Board</label>
                    <Select value={board} onValueChange={handleBoardChange}>
                      <SelectTrigger data-testid="select-board">
                        <SelectValue placeholder="Select a board" />
                      </SelectTrigger>
                      <SelectContent>
                        {boards.map((b) => (
                          <SelectItem key={b} value={b}>
                            {b}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Medium</label>
                    <Select value={medium} onValueChange={handleMediumChange} disabled={!board}>
                      <SelectTrigger data-testid="select-medium">
                        <SelectValue placeholder="Select a medium" />
                      </SelectTrigger>
                      <SelectContent>
                        {mediums.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Grade</label>
                    <Select value={grade} onValueChange={handleGradeChange} disabled={!board || !medium}>
                      <SelectTrigger data-testid="select-grade">
                        <SelectValue placeholder="Select a grade" />
                      </SelectTrigger>
                      <SelectContent>
                        {grades.map((g) => (
                          <SelectItem key={g} value={g}>
                            {g}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Subject{" "}
                      <span className="text-xs font-normal text-muted-foreground">(required)</span>
                    </label>
                    <Select
                      value={subject}
                      onValueChange={handleSubjectChange}
                      disabled={!hasBaseSelection || subjects.length === 0}
                    >
                      <SelectTrigger data-testid="select-subject">
                        <SelectValue
                          placeholder={
                            hasBaseSelection && subjects.length === 0
                              ? "No subjects available"
                              : "Select a subject"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {subjects.map((s) => (
                          <SelectItem key={s.name} value={s.name}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Chapter{" "}
                      <span className="text-xs font-normal text-muted-foreground">(required)</span>
                    </label>
                    <Select
                      value={chapter}
                      onValueChange={handleChapterChange}
                      disabled={!baseScopeSelected || chaptersLoading || chapters.length === 0}
                    >
                      <SelectTrigger data-testid="select-chapter">
                        <SelectValue
                          placeholder={
                            !baseScopeSelected
                              ? "Select a subject first"
                              : chaptersLoading
                                ? "Loading chapters…"
                                : chapters.length === 0
                                  ? "No chapters available"
                                  : "Select a chapter"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {chapters.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {hasFullSelection && (
                  <div className="flex items-center justify-between pt-2">
                    {matchCount > 0 ? (
                      <Badge
                        variant="secondary"
                        className="bg-green-100 text-green-800 hover:bg-green-100 gap-1"
                        data-testid="badge-match-count"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {matchCount} content pack{matchCount === 1 ? "" : "s"} matched
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="bg-amber-100 text-amber-800 hover:bg-amber-100 gap-1"
                        data-testid="badge-match-count"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        No match — bot will refuse
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleReset}
                      data-testid="button-reset"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
                    </Button>
                  </div>
                )}

                {hasFullSelection && (
                  <div className="mt-2 rounded-lg border bg-muted/40 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <Label htmlFor="switch-simulate-doubt" className="text-sm font-medium">
                          Simulate doubt session
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Preview the “Did this resolve your doubt?” prompt. Simulation only — no
                          doubt is closed and no support ticket is created.
                        </p>
                      </div>
                      <Switch
                        id="switch-simulate-doubt"
                        checked={simulateDoubt}
                        onCheckedChange={setSimulateDoubt}
                        disabled={isLive}
                        data-testid="switch-simulate-doubt"
                      />
                    </div>
                    {simulateDoubt && (
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <p className="text-xs text-muted-foreground">
                          After the tutor answers, the prompt appears once you stay idle for the
                          configured cooling period ({doubtCooldownSeconds}s).
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleShowDoubtPromptNow}
                          data-testid="button-show-doubt-prompt"
                        >
                          Show prompt now
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Live end-to-end test (real side effects on the client's system) */}
        {hasFullSelection && (
          <Card className="border-red-300 dark:border-red-900">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Radio className="w-4 h-4 text-red-600" />
                Live end-to-end test
                {isLive && (
                  <Badge className="bg-red-600 hover:bg-red-600 text-white gap-1" data-testid="badge-live-active">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-800 dark:text-red-300">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  <strong>This is NOT a simulation.</strong> A live session runs the exact
                  production flow: every message is synced to the client&apos;s portal, answering
                  &quot;No&quot; twice creates a real support ticket <strong>and sends a real
                  escalation email</strong> to their team. Use test IDs the client has approved.
                </span>
              </div>

              {!isLive ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Student ID <span className="text-xs font-normal text-muted-foreground">(required)</span>
                      </Label>
                      <Input
                        value={liveStudentId}
                        onChange={(e) => setLiveStudentId(e.target.value)}
                        placeholder="Test student ID"
                        data-testid="input-live-student-id"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Doubt ID <span className="text-xs font-normal text-muted-foreground">(required)</span>
                      </Label>
                      <Input
                        value={liveDoubtId}
                        onChange={(e) => setLiveDoubtId(e.target.value)}
                        placeholder="Test doubt ID"
                        data-testid="input-live-doubt-id"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Plan ID <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Input
                        value={livePlanId}
                        onChange={(e) => setLivePlanId(e.target.value)}
                        placeholder="Test plan ID"
                        data-testid="input-live-plan-id"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Student name <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Input
                        value={liveName}
                        onChange={(e) => setLiveName(e.target.value)}
                        placeholder="Live Test Student"
                        data-testid="input-live-name"
                      />
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={handleStartLiveSession}
                    disabled={isMinting || !liveStudentId.trim() || !liveDoubtId.trim()}
                    data-testid="button-start-live-session"
                  >
                    {isMinting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Starting…
                      </>
                    ) : (
                      <>
                        <Radio className="w-4 h-4 mr-1" /> Start live session
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      Live session running for doubt <code className="font-mono">{liveActiveDoubtId}</code>.
                      Chat in the preview below exactly as a student would — the doubt prompt,
                      retry, ticket, and escalation email are all real.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleEndLiveSession}
                      data-testid="button-end-live-session"
                    >
                      <XCircle className="w-3.5 h-3.5 mr-1" /> End live session
                    </Button>
                  </div>

                  <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Delivery to client&apos;s system</p>
                      {syncLog && !syncLog.doubtSyncConfigured && (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100 gap-1">
                          <AlertTriangle className="w-3 h-3" /> Sync base URL not configured
                        </Badge>
                      )}
                    </div>
                    {(syncLog?.events?.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No sync activity yet — it appears here as messages are mirrored, the doubt
                        is closed, or the escalation email fires. Updates every few seconds.
                      </p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-1" data-testid="list-sync-events">
                        {syncLog!.events.map((e, i) => (
                          <div key={`${e.at}-${i}`} className="flex items-center gap-2 text-xs">
                            {e.ok ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                            )}
                            <span className="font-mono text-muted-foreground shrink-0">
                              {new Date(e.at).toLocaleTimeString()}
                            </span>
                            <span className="font-medium shrink-0">
                              {e.kind === "message"
                                ? "Message sync"
                                : e.kind === "attachment"
                                  ? "Attachment sync"
                                  : e.kind === "close"
                                    ? "Doubt close"
                                    : "Escalation email"}
                            </span>
                            <span className="text-muted-foreground truncate">{e.detail}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Middle: live preview (full width) */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Live preview
              {isLive && (
                <Badge className="bg-red-600 hover:bg-red-600 text-white gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE — real data
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            {!hasFullSelection ? (
              <div className="h-[720px] w-full rounded-lg border border-dashed flex items-center justify-center text-sm text-muted-foreground text-center px-6">
                Select a board, medium, grade, subject, and chapter to load the live widget preview.
              </div>
            ) : !previewUrl ? (
              <div
                className="h-[720px] w-full rounded-lg border border-dashed flex items-center justify-center text-sm text-muted-foreground text-center px-6"
                data-testid="preview-signing"
              >
                Preparing the preview session...
              </div>
            ) : (
              <div className="h-[720px] w-full rounded-lg overflow-hidden border bg-background">
                <iframe
                  ref={previewIframeRef}
                  key={previewKey}
                  src={previewUrl}
                  title="Grade-scoped widget preview"
                  className="w-full h-full"
                  data-testid="iframe-widget-preview"
                />
              </div>
            )}
            {!isLive && previewTokenError && (
              <p className="mt-2 text-xs text-red-600" data-testid="text-preview-token-error">
                Preview unavailable: {previewTokenError}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Bottom: embed snippet (full width) */}
        {hasFullSelection && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Embed snippet</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                data-testid="button-copy-snippet"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                  </>
                )}
              </Button>
            </CardHeader>
            <CardContent>
              <pre
                className="text-xs bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all"
                data-testid="text-embed-snippet"
              >
                {embedSnippet}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
