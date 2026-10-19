import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Copy, KeyRound, Loader2 } from "lucide-react";

interface LmsApiKeyStatus {
  configured: boolean;
  last4: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

const KEY_URL = "/api/topscholar/lms-api-key";

async function call(method: string): Promise<LmsApiKeyStatus & { key?: string }> {
  const r = await fetch(KEY_URL, { method, credentials: "include" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Request failed");
  return data;
}

function when(value: string | null) {
  return value ? new Date(value).toLocaleString() : "never";
}

// Settings card for the LMS embedding API key (server-to-server, CP-ID-only refresh).
export default function TopScholarLmsApiCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery<LmsApiKeyStatus>({
    queryKey: [KEY_URL],
    queryFn: () => call("GET"),
  });

  const generate = useMutation({
    mutationFn: () => call("POST"),
    onSuccess: (data) => {
      setNewKey(data.key ?? null);
      queryClient.setQueryData([KEY_URL], data);
      toast({ title: "New API key created", description: "Copy it now. It won't be shown again." });
    },
    onError: (e: any) => toast({ title: "Couldn't create a key", description: e.message, variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: () => call("DELETE"),
    onSuccess: (data) => {
      setNewKey(null);
      queryClient.setQueryData([KEY_URL], data);
      toast({ title: "API key revoked", description: "Calls with the old key are now refused." });
    },
    onError: (e: any) => toast({ title: "Couldn't revoke the key", description: e.message, variant: "destructive" }),
  });

  const busy = generate.isPending || revoke.isPending;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-violet-600" /> LMS embedding API
        </CardTitle>
        <CardDescription>
          Lets TopScholar's LMS ask us to embed (or refresh) curriculum packages by CP ID, from its own server.
          The work runs through the same queue as Content Sync.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        ) : status?.configured ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
            <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Active</Badge>
            <span>Key ending <span className="font-mono">…{status.last4}</span></span>
            <span className="text-xs text-gray-500">Created {when(status.createdAt)} · Last used {when(status.lastUsedAt)}</span>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No key yet. The API refuses every call until you create one.</p>
        )}

        {newKey && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
            <p className="text-xs font-medium text-amber-800">Copy this key now and send it to the client securely. It won't be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs text-gray-800 border">{newKey}</code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => {
                  navigator.clipboard?.writeText(newKey).then(
                    () => toast({ title: "Copied" }),
                    () => toast({ title: "Couldn't copy", description: "Select the key and copy it manually.", variant: "destructive" }),
                  );
                }}
              >
                <Copy className="w-4 h-4" /> Copy
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="bg-violet-600 gap-1.5"
            disabled={busy}
            onClick={() => {
              if (status?.configured && !window.confirm("Create a new key? The current key stops working immediately.")) return;
              generate.mutate();
            }}
          >
            {generate.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {status?.configured ? "Replace key" : "Create key"}
          </Button>
          {status?.configured && (
            <Button
              type="button"
              variant="outline"
              className="text-red-600 hover:text-red-700"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Revoke the key? The LMS can no longer request embeddings until you create a new one.")) {
                  revoke.mutate();
                }
              }}
            >
              {revoke.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />} Revoke
            </Button>
          )}
        </div>

        <pre className="overflow-x-auto rounded bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">{`# From the LMS server only (never a browser):
#   Authorization: Bearer <key>

POST ${origin}/api/topscholar/v1/embed           { "cpIds": ["<cp id>", ...], "planId": "<plan id>" }   # up to 50; planId optional
#    or { "items": [{ "cpId": "...", "planId": "..." }, ...] } for packages from different Plans
GET  ${origin}/api/topscholar/v1/embed/status?cpIds=<id1>,<id2>
GET  ${origin}/api/topscholar/v1/embed/jobs/<jobId>`}</pre>
      </CardContent>
    </Card>
  );
}
