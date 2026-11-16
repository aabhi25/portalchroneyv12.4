import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Upload,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader2,
  FileUp,
} from "lucide-react";
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
import { format } from "date-fns";
import TrainingNavTabs from "@/components/TrainingNavTabs";
import { ChannelPicker, ChannelBadge, ChannelFilterSelect, matchesChannelFilter, type ChannelFilterValue } from "@/components/ChannelPicker";
import { type KnowledgeChannel } from "@shared/knowledgeChannels";
import { apiRequest } from "@/lib/queryClient";

interface TrainingDocument {
  id: string;
  businessAccountId: string;
  filename: string;
  originalFilename: string;
  fileSize: string;
  storageKey: string;
  uploadStatus: 'pending' | 'processing' | 'completed' | 'failed';
  extractedText?: string | null;
  summary?: string | null;
  keyPoints?: string | null;
  errorMessage?: string | null;
  uploadedBy: string;
  processedAt?: string | null;
  channels?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB in bytes

export default function ScanDocs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null);
  const [uploadChannels, setUploadChannels] = useState<KnowledgeChannel[] | null>(null);
  const [channelFilter, setChannelFilter] = useState<ChannelFilterValue>("all");

  const { data: documents = [], isLoading } = useQuery<TrainingDocument[]>({
    queryKey: ["/api/training-documents"],
    refetchInterval: (query) => {
      // Poll every 2 seconds if any documents are processing
      const docs = query.state.data || [];
      const hasProcessing = docs.some((d: TrainingDocument) => d.uploadStatus === 'processing' || d.uploadStatus === 'pending');
      return hasProcessing ? 2000 : false;
    },
  });

  const visibleDocuments = documents.filter(d => matchesChannelFilter(d.channels, channelFilter));

  const channelsMutation = useMutation({
    mutationFn: async ({ id, channels }: { id: string; channels: KnowledgeChannel[] | null }) => {
      return await apiRequest("PATCH", `/api/training-documents/${id}`, { channels });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/training-documents"] });
      toast({
        title: "Channels Updated",
        description: "The document's channels were saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update channels",
        variant: "destructive",
      });
    },
  });

  const stats = {
    total: documents.length,
    completed: documents.filter(d => d.uploadStatus === 'completed').length,
    processing: documents.filter(d => d.uploadStatus === 'processing' || d.uploadStatus === 'pending').length,
    failed: documents.filter(d => d.uploadStatus === 'failed').length,
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/training-documents/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete document");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/training-documents"] });
      setDeleteDialogOpen(false);
      setDocumentToDelete(null);
      toast({
        title: "Document Deleted",
        description: "Training document removed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const validateFile = (file: File): string | null => {
    if (file.type !== "application/pdf") {
      return "Only PDF files are allowed";
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File size must be less than 25MB (${(file.size / (1024 * 1024)).toFixed(2)}MB provided)`;
    }
    return null;
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const filesArray = Array.from(files);
    
    for (const file of filesArray) {
      const error = validateFile(file);
      if (error) {
        toast({
          title: "Invalid File",
          description: `${file.name}: ${error}`,
          variant: "destructive",
        });
        continue;
      }

      try {
        setIsUploading(true);
        setUploadProgress(0);

        const formData = new FormData();
        formData.append("file", file);
        if (uploadChannels && uploadChannels.length > 0) {
          formData.append("channels", JSON.stringify(uploadChannels));
        }

        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const progress = (e.loaded / e.total) * 100;
            setUploadProgress(progress);
          }
        });

        const uploadPromise = new Promise<void>((resolve, reject) => {
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              try {
                const error = JSON.parse(xhr.responseText);
                reject(new Error(error.error || "Upload failed"));
              } catch {
                reject(new Error("Upload failed"));
              }
            }
          });

          xhr.addEventListener("error", () => {
            reject(new Error("Network error during upload"));
          });

          xhr.open("POST", "/api/training-documents");
          xhr.withCredentials = true;
          xhr.send(formData);
        });

        await uploadPromise;

        toast({
          title: "Upload Successful",
          description: `${file.name} uploaded successfully. Processing will begin shortly.`,
        });

        queryClient.invalidateQueries({ queryKey: ["/api/training-documents"] });
        
      } catch (error: any) {
        toast({
          title: "Upload Failed",
          description: error.message || `Failed to upload ${file.name}`,
          variant: "destructive",
        });
      }
    }

    setIsUploading(false);
    setUploadProgress(0);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      uploadFiles(files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      uploadFiles(files);
    }
  };

  const handleDelete = (id: string) => {
    setDocumentToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (documentToDelete) {
      deleteMutation.mutate(documentToDelete);
    }
  };

  const formatFileSize = (bytes: string): string => {
    const size = parseInt(bytes);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  };

  const parseKeyPoints = (keyPoints: string | null): string[] => {
    if (!keyPoints) return [];
    try {
      return JSON.parse(keyPoints);
    } catch {
      return [];
    }
  };

  const [openDoc, setOpenDoc] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto bg-gray-50/60">
        <TrainingNavTabs />
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
        </div>
      </div>
    );
  }

  const card = "rounded-2xl border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
  const statusDot: Record<string, string> = {
    completed: "bg-emerald-500", processing: "bg-blue-500", pending: "bg-amber-400", failed: "bg-red-500",
  };
  const statusText: Record<string, string> = {
    completed: "Ready", processing: "Reading…", pending: "Waiting", failed: "Failed",
  };

  return (
    <div className="flex-1 overflow-auto bg-gray-50/60">
      <TrainingNavTabs />
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
        {/* Upload */}
        <section
          className={`${card} p-5 transition-colors ${isDragging ? "border-purple-400 bg-purple-50/60" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          data-testid="docs-upload"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-50">
                <FileUp className="h-5 w-5 text-purple-600" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-gray-900">Documents</h1>
                <p className="text-sm text-gray-500">
                  {isDragging ? "Drop the PDFs to upload them" : "Brochures, price lists, policies… The AI reads each PDF and answers from it. Drag files here or choose them."}
                </p>
              </div>
            </div>
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="shrink-0 bg-purple-600 text-white hover:bg-purple-700"
              data-testid="button-docs-upload"
            >
              {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {isUploading ? "Uploading…" : "Upload PDFs"}
            </Button>
            <input ref={fileInputRef} type="file" accept="application/pdf" multiple onChange={handleFileSelect} className="hidden" />
          </div>
          {isUploading && (
            <div className="mt-4 flex items-center gap-3">
              <Progress value={uploadProgress} className="h-1.5 flex-1" />
              <span className="w-10 text-right text-xs text-gray-500">{Math.round(uploadProgress)}%</span>
            </div>
          )}
          <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-md">
              <ChannelPicker value={uploadChannels} onChange={setUploadChannels} disabled={isUploading} />
            </div>
            <p className="text-xs text-gray-400 sm:text-right">PDF only · up to 25 MB each · several at once</p>
          </div>
        </section>

        {/* List */}
        <section className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900">Your documents</h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500" data-testid="text-docs-counts">
                <span>{stats.total} total</span>
                {stats.completed > 0 && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{stats.completed} ready</span>}
                {stats.processing > 0 && <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" />{stats.processing} being read</span>}
                {stats.failed > 0 && <span className="flex items-center gap-1 text-red-600"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{stats.failed} failed</span>}
              </p>
            </div>
            {documents.length > 0 && <ChannelFilterSelect value={channelFilter} onChange={setChannelFilter} />}
          </div>

          {documents.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="font-medium text-gray-700">No documents yet</p>
              <p className="mt-1 text-sm text-gray-500">Upload a PDF and the AI starts using it in a minute or two.</p>
            </div>
          ) : visibleDocuments.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="mb-3 text-sm text-gray-600">No documents are used on this channel</p>
              <Button variant="outline" size="sm" onClick={() => setChannelFilter("all")}>Show all channels</Button>
            </div>
          ) : (
            <ul className="divide-y">
              {visibleDocuments.map((doc) => {
                const keyPoints = parseKeyPoints(doc.keyPoints ?? null);
                const open = openDoc === doc.id;
                const hasDetails = (doc.uploadStatus === "completed" && (doc.summary || keyPoints.length > 0)) || (doc.uploadStatus === "failed" && doc.errorMessage);
                return (
                  <li key={doc.id} data-testid={`row-doc-${doc.id}`}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                      <button
                        type="button"
                        onClick={() => hasDetails && setOpenDoc(open ? null : doc.id)}
                        className={`flex min-w-0 flex-1 basis-full items-center gap-3 text-left sm:basis-0 ${hasDetails ? "cursor-pointer" : "cursor-default"}`}
                      >
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-50 text-[10px] font-bold text-red-600">PDF</div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900" title={doc.originalFilename}>{doc.originalFilename}</p>
                          <p className="text-xs text-gray-500">
                            {formatFileSize(doc.fileSize)} · {format(new Date(doc.createdAt), "d MMM yyyy")}
                            {hasDetails && <span className="ml-2 text-purple-600">{open ? "Hide details" : doc.uploadStatus === "failed" ? "Why it failed" : "What the AI learnt"}</span>}
                          </p>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
                        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs text-gray-700" data-testid={`status-doc-${doc.uploadStatus}`}>
                          {doc.uploadStatus === "processing" ? <Loader2 className="h-3 w-3 animate-spin text-blue-500" /> : <span className={`h-1.5 w-1.5 rounded-full ${statusDot[doc.uploadStatus] ?? "bg-gray-400"}`} />}
                          {statusText[doc.uploadStatus] ?? doc.uploadStatus}
                        </span>
                        <ChannelPicker
                          compact
                          value={doc.channels ?? null}
                          disabled={channelsMutation.isPending}
                          onChange={(channels) => channelsMutation.mutate({ id: doc.id, channels })}
                        />
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:bg-red-50 hover:text-red-600" onClick={() => handleDelete(doc.id)} aria-label={`Delete ${doc.originalFilename}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {open && (
                      <div className="space-y-3 bg-gray-50/70 px-5 py-4 text-sm">
                        {doc.uploadStatus === "failed" && doc.errorMessage && (
                          <p className="flex items-start gap-2 text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{doc.errorMessage}</p>
                        )}
                        {doc.summary && <p className="text-gray-700">{doc.summary}</p>}
                        {keyPoints.length > 0 && (
                          <ul className="space-y-1.5">
                            {keyPoints.map((point, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-gray-700">
                                <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                <span>{point}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Training Document?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. The document and its processed data will be permanently removed
                from your AI assistant's training knowledge.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                className="bg-red-600 hover:bg-red-700"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
