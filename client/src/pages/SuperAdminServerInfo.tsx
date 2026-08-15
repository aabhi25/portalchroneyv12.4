import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Globe, Server, RefreshCw, Copy, CheckCircle2, Clock, Cpu, Loader2 } from "lucide-react";
import { useState } from "react";

interface ServerInfo {
  outboundIp: string;
  env: string;
  hostname: string;
  platform: string;
  nodeVersion: string;
  uptime: number;
  checkedAt: string;
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

export default function SuperAdminServerInfo() {
  const [copied, setCopied] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<ServerInfo>({
    queryKey: ["/api/admin/server-info"],
    queryFn: async () => {
      const res = await fetch("/api/admin/server-info", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch server info");
      return res.json();
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const copyIp = () => {
    if (!data?.outboundIp) return;
    navigator.clipboard.writeText(data.outboundIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const envColor = data?.env === "production" ? "bg-green-100 text-green-800 border-green-200"
    : data?.env === "development" ? "bg-blue-100 text-blue-800 border-blue-200"
    : "bg-gray-100 text-gray-700 border-gray-200";

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 px-6 py-4 bg-white border-b border-gray-200">
        <SidebarTrigger />
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-500 to-gray-700 flex items-center justify-center">
            <Server className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Server Info</h1>
            <p className="text-xs text-gray-500">Live outbound IP and environment details</p>
          </div>
        </div>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {isLoading && (
          <div className="flex items-center justify-center h-48 gap-2 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Fetching server info...</span>
          </div>
        )}

        {isError && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6 text-center text-red-700">
              Failed to load server info. Make sure you are logged in as super admin.
            </CardContent>
          </Card>
        )}

        {data && (
          <div className="space-y-4">
            <Card className="border-2 border-slate-200 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="w-5 h-5 text-slate-600" />
                    <CardTitle className="text-base">Outbound IP Address</CardTitle>
                  </div>
                  <Badge variant="outline" className={`text-xs font-medium border ${envColor}`}>
                    {data.env}
                  </Badge>
                </div>
                <CardDescription>
                  Share this IP with third-party APIs (e.g. Caprion CRM) for IP whitelisting
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                  <span className="text-2xl font-mono font-bold text-slate-800 tracking-wider flex-1">
                    {data.outboundIp}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyIp}
                    className="gap-1.5 text-slate-600 hover:text-slate-900"
                  >
                    {copied ? (
                      <><CheckCircle2 className="w-4 h-4 text-green-600" /> Copied</>
                    ) : (
                      <><Copy className="w-4 h-4" /> Copy</>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Checked at {new Date(data.checkedAt).toLocaleString()}
                </p>
              </CardContent>
            </Card>

            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-gray-500" />
                  <CardTitle className="text-sm text-gray-700">Server Details</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Hostname</dt>
                    <dd className="font-mono text-gray-800 truncate">{data.hostname}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Platform</dt>
                    <dd className="font-mono text-gray-800">{data.platform}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Node.js</dt>
                    <dd className="font-mono text-gray-800">{data.nodeVersion}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">Uptime</dt>
                    <dd className="font-mono text-gray-800 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-400" />
                      {formatUptime(data.uptime)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-400 text-xs uppercase tracking-wide mb-0.5">App Version</dt>
                    <dd className="font-mono text-gray-800">9.8</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <p className="text-xs text-center text-gray-400">
              This page always reflects the live server's current outbound IP — works across any hosting environment.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
