import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useLocation } from "wouter";
import { ArrowLeft, MessageSquareText, Loader2, CheckCircle, XCircle, Clock, SkipForward, Settings } from "lucide-react";

interface FacebookComment {
  id: string;
  businessAccountId: string;
  postId: string | null;
  commentId: string | null;
  commentText: string | null;
  commenterName: string | null;
  commenterId: string | null;
  replyText: string | null;
  replyCommentId: string | null;
  status: string;
  dmStatus: string | null;
  dmText: string | null;
  createdAt: string;
}

interface CommentStats {
  total: number;
  pending: number;
  replied: number;
  skipped: number;
  failed: number;
}

interface CommentsResponse {
  comments: FacebookComment[];
  total: number;
  stats: CommentStats;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "replied":
      return <Badge className="bg-green-100 text-green-700 hover:bg-green-100"><CheckCircle className="w-3 h-3 mr-1" />Replied</Badge>;
    case "failed":
      return <Badge className="bg-red-100 text-red-700 hover:bg-red-100"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
    case "pending":
      return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    case "skipped":
      return <Badge className="bg-gray-100 text-gray-600 hover:bg-gray-100"><SkipForward className="w-3 h-3 mr-1" />Skipped</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function FacebookComments() {
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data, isLoading } = useQuery<CommentsResponse>({
    queryKey: ["/api/facebook/comments", statusFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(page * limit),
      });
      if (statusFilter !== "all") params.set("status", statusFilter);
      return await apiRequest("GET", `/api/facebook/comments?${params.toString()}`);
    },
  });

  const comments = data?.comments || [];
  const total = data?.total || 0;
  const stats = data?.stats;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-50 flex items-center gap-4 border-b px-4 h-14 shrink-0 bg-gradient-to-r from-blue-600 to-blue-500 text-white">
        <SidebarTrigger />
        <Button variant="ghost" size="sm" onClick={() => setLocation("/admin/facebook")} className="gap-1 text-white/80 hover:text-white hover:bg-white/10">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="flex items-center gap-2 flex-1">
          <MessageSquareText className="w-5 h-5 text-white" />
          <h1 className="text-lg font-semibold">Facebook Comment Auto-Replies</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLocation("/admin/facebook-comment-settings")}
          className="border-white/30 text-white hover:bg-white/10 hover:text-white"
        >
          <Settings className="w-4 h-4 mr-1.5" />
          Settings
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 max-w-4xl">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold text-green-600">{stats.replied}</div>
                <div className="text-xs text-muted-foreground">Replied</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
                <div className="text-xs text-muted-foreground">Pending</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold text-gray-500">{stats.skipped}</div>
                <div className="text-xs text-muted-foreground">Skipped</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="flex items-center justify-between">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="replied">Replied</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="skipped">Skipped</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">{total} comment{total !== 1 ? "s" : ""}</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : comments.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <MessageSquareText className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <h3 className="font-medium text-muted-foreground">No comments yet</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Comments will appear here once your Facebook page receives comments and auto-reply is enabled.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => (
              <Card key={comment.id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {comment.commenterName || comment.commenterId || "Unknown"}
                        </span>
                        {getStatusBadge(comment.status)}
                        <span className="text-xs text-muted-foreground">
                          {new Date(comment.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-sm text-gray-800">{comment.commentText || "—"}</p>
                      </div>
                      {comment.replyText && (
                        <div className="bg-blue-50 rounded-lg p-3 ml-4 border-l-2 border-blue-300">
                          <p className="text-xs font-medium text-blue-700 mb-1">AI Reply:</p>
                          <p className="text-sm text-gray-800">{comment.replyText}</p>
                        </div>
                      )}
                      {comment.dmStatus && (
                        <div className={`rounded-lg p-3 ml-4 border-l-2 ${comment.dmStatus === "sent" ? "bg-purple-50 border-purple-300" : "bg-red-50 border-red-300"}`}>
                          <p className={`text-xs font-medium mb-1 ${comment.dmStatus === "sent" ? "text-purple-700" : "text-red-700"}`}>
                            {comment.dmStatus === "sent" ? "DM Sent:" : "DM Failed"}
                          </p>
                          {comment.dmText && <p className="text-sm text-gray-800">{comment.dmText}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}