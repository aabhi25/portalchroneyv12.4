import { useEffect, useRef, useState, useCallback } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Terminal, Download, Trash2, Pause, Play, Wifi, WifiOff, Search } from "lucide-react";

interface LogEntry {
  id: number;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

type LevelFilter = "all" | "info" | "warn" | "error";

const LEVEL_COLORS: Record<string, string> = {
  info:  "text-green-400",
  warn:  "text-yellow-400",
  error: "text-red-400",
  debug: "text-gray-400",
};

const LEVEL_BADGE: Record<string, string> = {
  info:  "bg-green-900/60 text-green-300 border-green-700",
  warn:  "bg-yellow-900/60 text-yellow-300 border-yellow-700",
  error: "bg-red-900/60 text-red-300 border-red-700",
  debug: "bg-gray-800 text-gray-400 border-gray-600",
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
    "." + String(d.getMilliseconds()).padStart(3, "0");
}

export default function SuperAdminLiveLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LevelFilter>("all");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const pendingRef = useRef<LogEntry[]>([]);
  const userScrolledUp = useRef(false);

  pausedRef.current = paused;

  const flushPending = useCallback(() => {
    if (pendingRef.current.length > 0) {
      setLogs(prev => {
        const combined = [...prev, ...pendingRef.current].slice(-2000);
        pendingRef.current = [];
        return combined;
      });
    }
  }, []);

  useEffect(() => {
    let es: EventSource;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource("/api/admin/live-logs/stream", { withCredentials: true });

      es.onopen = () => setConnected(true);

      es.onmessage = (e) => {
        try {
          const entry: LogEntry = JSON.parse(e.data);
          if (pausedRef.current) {
            pendingRef.current.push(entry);
          } else {
            setLogs(prev => [...prev, entry].slice(-2000));
          }
        } catch {}
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        retryTimeout = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, []);

  useEffect(() => {
    if (!paused) {
      flushPending();
    }
  }, [paused, flushPending]);

  useEffect(() => {
    if (!userScrolledUp.current && !paused) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, paused]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    userScrolledUp.current = !atBottom;
  };

  const clearLogs = () => setLogs([]);

  const downloadLogs = () => {
    const text = filtered
      .map(e => `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.message}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `server-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const scrollToBottom = () => {
    userScrolledUp.current = false;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const filtered = logs.filter(e => {
    if (filter !== "all" && e.level !== filter && !(filter === "error" && e.level === "error")) {
      if (filter === "error" && e.level === "error") return true;
      if (filter !== "all" && e.level !== filter) return false;
    }
    if (search.trim()) {
      return e.message.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  const levelFiltered = filter === "all"
    ? logs
    : logs.filter(e => e.level === filter || (filter === "error" && e.level === "error"));

  const searchFiltered = search.trim()
    ? levelFiltered.filter(e => e.message.toLowerCase().includes(search.toLowerCase()))
    : levelFiltered;

  const counts = {
    info:  logs.filter(e => e.level === "info").length,
    warn:  logs.filter(e => e.level === "warn").length,
    error: logs.filter(e => e.level === "error").length,
  };

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
      <header className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <SidebarTrigger className="text-gray-400 hover:text-gray-100" />
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-green-600 to-emerald-800 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-100 leading-tight">Live Server Logs</h1>
            <p className="text-xs text-gray-500 leading-tight">Real-time server console output</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 ml-2">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          <span className="text-xs text-gray-400">{connected ? "Live" : "Reconnecting..."}</span>
          {connected ? <Wifi className="w-3.5 h-3.5 text-green-500" /> : <WifiOff className="w-3.5 h-3.5 text-red-500" />}
        </div>

        <div className="flex items-center gap-2 ml-3">
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded font-mono">
            {searchFiltered.length} / {logs.length}
          </span>
          {counts.warn > 0 && (
            <span className="text-xs text-yellow-400 bg-yellow-900/40 px-2 py-0.5 rounded font-mono">
              ⚠ {counts.warn}
            </span>
          )}
          {counts.error > 0 && (
            <span className="text-xs text-red-400 bg-red-900/40 px-2 py-0.5 rounded font-mono">
              ✕ {counts.error}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter messages..."
              className="h-7 w-48 pl-7 text-xs bg-gray-800 border-gray-700 text-gray-200 placeholder:text-gray-600 focus-visible:ring-green-700"
            />
          </div>

          <div className="flex items-center gap-1 bg-gray-800 rounded p-0.5">
            {(["all", "info", "warn", "error"] as LevelFilter[]).map(l => (
              <button
                key={l}
                onClick={() => setFilter(l)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  filter === l
                    ? "bg-gray-600 text-white"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPaused(p => !p)}
            className={`h-7 px-2 text-xs gap-1.5 ${paused ? "text-yellow-400 bg-yellow-900/20 hover:bg-yellow-900/30" : "text-gray-400 hover:text-gray-100"}`}
          >
            {paused ? <><Play className="w-3.5 h-3.5" /> Resume</> : <><Pause className="w-3.5 h-3.5" /> Pause</>}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={downloadLogs}
            className="h-7 px-2 text-xs gap-1.5 text-gray-400 hover:text-gray-100"
          >
            <Download className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={clearLogs}
            className="h-7 px-2 text-xs gap-1.5 text-gray-400 hover:text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </header>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-xs leading-relaxed p-3 space-y-0.5"
        style={{ background: "#0d1117" }}
      >
        {searchFiltered.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-600">
            {logs.length === 0 ? "Waiting for log entries..." : "No entries match your filter."}
          </div>
        )}

        {searchFiltered.map(entry => (
          <div
            key={entry.id}
            className="flex gap-2 hover:bg-white/5 rounded px-1 py-0.5 group"
          >
            <span className="text-gray-600 flex-shrink-0 select-none tabular-nums">
              {formatTime(entry.timestamp)}
            </span>
            <span className={`flex-shrink-0 uppercase text-[10px] font-bold tracking-wider w-9 text-right ${LEVEL_COLORS[entry.level] || "text-gray-400"}`}>
              {entry.level}
            </span>
            <span className={`flex-1 break-all whitespace-pre-wrap ${entry.level === "error" ? "text-red-300" : entry.level === "warn" ? "text-yellow-200" : "text-gray-300"}`}>
              {entry.message}
            </span>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {userScrolledUp.current && (
        <div className="absolute bottom-6 right-6">
          <Button
            size="sm"
            onClick={scrollToBottom}
            className="bg-green-700 hover:bg-green-600 text-white text-xs shadow-lg"
          >
            ↓ Jump to bottom
          </Button>
        </div>
      )}

      {paused && pendingRef.current.length > 0 && (
        <div className="flex-shrink-0 bg-yellow-900/30 border-t border-yellow-700/40 px-4 py-1.5 text-xs text-yellow-400 flex items-center gap-2">
          <Pause className="w-3 h-3" />
          Paused — {pendingRef.current.length} new entries buffered. Click Resume to see them.
        </div>
      )}
    </div>
  );
}
