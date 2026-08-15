import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Upload,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Loader2,
  FileUp,
  Files,
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { format } from "date-fns";
import TrainingNavTabs from "@/components/TrainingNavTabs";

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
  const [activeTab, setActiveTab] = useState("overview");

  const { data: documents = [], isLoading } = useQuery<TrainingDocument[]>({
    queryKey: ["/api/training-documents"],
    refetchInterval: (query) => {
      // Poll every 2 seconds if any documents are processing
      const docs = query.state.data || [];
      const hasProcessing = docs.some((d: TrainingDocument) => d.uploadStatus === 'processing' || d.uploadStatus === 'pending');
      return hasProcessing ? 2000 : false;
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
        
        // Switch to Documents tab after successful upload
        setActiveTab("documents");
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
            <CheckCircle className="w-3 h-3 mr-1" />
            Completed
          </Badge>
        );
      case 'processing':
        return (
          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Processing
          </Badge>
        );
      case 'pending':
        return (
          <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
            <XCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const parseKeyPoints = (keyPoints: string | null): string[] => {
    if (!keyPoints) return [];
    try {
      return JSON.parse(keyPoints);
    } catch {
      return [];
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30">
        <TrainingNavTabs />
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto mb-3" />
            <p className="text-sm text-gray-600">Loading training documents...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-br from-gray-50 via-purple-50/30 to-blue-50/30">
      <TrainingNavTabs />
      <div className="container mx-auto p-4 md:p-6 max-w-[1600px]">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-gradient-to-r from-purple-50 to-white backdrop-blur-sm shadow-md h-auto p-1 rounded-xl">
            <TabsTrigger value="overview" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <FileUp className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="documents" className="rounded-lg data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-200 data-[state=active]:to-blue-100 data-[state=active]:text-purple-900 data-[state=active]:font-semibold">
              <Files className="w-4 h-4 mr-2" />
              Documents
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            {/* Hero Section */}
            <Card className="border-0 shadow-lg bg-gradient-to-br from-[#0B0F1A] via-[#1e3a8a] to-[#7c3aed] text-white overflow-hidden">
              <CardHeader className="relative pb-6">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32"></div>
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/10 rounded-full -ml-24 -mb-24"></div>
                <div className="relative">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                      <FileText className="w-8 h-8" />
                    </div>
                    <div>
                      <CardTitle className="text-3xl font-bold">Training Documents</CardTitle>
                      <CardDescription className="text-purple-100 mt-1">
                        Upload PDFs to train your AI assistant with custom knowledge
                      </CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="border-gray-200/60 bg-white/80 backdrop-blur-sm shadow-md">
                <CardHeader className="pb-3">
                  <CardDescription className="text-gray-600">Total Documents</CardDescription>
                  <CardTitle className="text-3xl font-bold text-purple-600">{stats.total}</CardTitle>
                </CardHeader>
              </Card>
              
              <Card className="border-gray-200/60 bg-white/80 backdrop-blur-sm shadow-md">
                <CardHeader className="pb-3">
                  <CardDescription className="text-gray-600">Completed</CardDescription>
                  <CardTitle className="text-3xl font-bold text-green-600 flex items-center gap-2">
                    {stats.completed}
                    <CheckCircle className="w-5 h-5" />
                  </CardTitle>
                </CardHeader>
              </Card>
              
              <Card className="border-gray-200/60 bg-white/80 backdrop-blur-sm shadow-md">
                <CardHeader className="pb-3">
                  <CardDescription className="text-gray-600">Processing</CardDescription>
                  <CardTitle className="text-3xl font-bold text-blue-600 flex items-center gap-2">
                    {stats.processing}
                    <Clock className="w-5 h-5" />
                  </CardTitle>
                </CardHeader>
              </Card>
              
              <Card className="border-gray-200/60 bg-white/80 backdrop-blur-sm shadow-md">
                <CardHeader className="pb-3">
                  <CardDescription className="text-gray-600">Failed</CardDescription>
                  <CardTitle className="text-3xl font-bold text-red-600 flex items-center gap-2">
                    {stats.failed}
                    <XCircle className="w-5 h-5" />
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            {/* Upload Zone */}
            <Card className="border-gray-200/60 bg-white/80 backdrop-blur-sm shadow-md">
              <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                <CardTitle className="text-lg">Upload Training Documents</CardTitle>
                <CardDescription>
                  Upload PDF files to enhance your AI's knowledge (Max 25MB per file)
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <div
                  className={`border-2 border-dashed rounded-xl p-8 transition-all ${
                    isDragging
                      ? "border-purple-500 bg-purple-50"
                      : "border-gray-300 hover:border-purple-400 hover:bg-gray-50"
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="text-center">
                    <Upload className={`w-12 h-12 mx-auto mb-4 ${isDragging ? "text-purple-500" : "text-gray-400"}`} />
                    <h3 className="text-lg font-semibold mb-2">
                      {isDragging ? "Drop files here" : "Drag & drop PDF files here"}
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">or</p>
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          Choose Files
                        </>
                      )}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <div className="mt-4 text-xs text-gray-500">
                      <p>Supported format: PDF</p>
                      <p>Maximum file size: 25MB</p>
                      <p>Multiple files can be uploaded at once</p>
                    </div>
                  </div>
                </div>

                {isUploading && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">Uploading...</span>
                      <span className="text-sm text-gray-600">{Math.round(uploadProgress)}%</span>
                    </div>
                    <Progress value={uploadProgress} className="h-2" />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="documents" className="space-y-6 mt-6">
            <Card className="border-gray-200/60 bg-white/80 backdrop-blur-sm shadow-md">
              <CardHeader className="border-b bg-gradient-to-r from-purple-50/50 to-pink-50/50">
                <CardTitle className="text-lg">Uploaded Documents</CardTitle>
                <CardDescription>
                  View and manage your training documents ({documents.length} total)
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {documents.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-semibold text-gray-700 mb-2">No documents yet</h3>
                    <p className="text-gray-600 mb-4">
                      Upload your first PDF document to start training your AI assistant
                    </p>
                    <Button
                      onClick={() => document.querySelector<HTMLElement>('[value="overview"]')?.click()}
                      className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      Go to Upload
                    </Button>
                  </div>
                ) : (
                  <Accordion type="single" collapsible className="space-y-3">
                    {documents.map((doc) => (
                      <AccordionItem
                        key={doc.id}
                        value={doc.id}
                        className="border rounded-lg overflow-hidden bg-white shadow-sm"
                      >
                        <AccordionTrigger className="px-4 py-3 hover:bg-gray-50 hover:no-underline">
                          <div className="flex items-start justify-between w-full pr-4">
                            <div className="flex items-start gap-3 flex-1 text-left">
                              <FileText className="w-5 h-5 text-purple-600 mt-1 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-gray-900 truncate mb-1">
                                  {doc.originalFilename}
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                                  <span>Uploaded: {format(new Date(doc.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
                                  <span>•</span>
                                  <span>Size: {formatFileSize(doc.fileSize)}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {getStatusBadge(doc.uploadStatus)}
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 bg-gray-50/50">
                          <div className="space-y-4 pt-2">
                            {doc.uploadStatus === 'completed' && (
                              <>
                                {doc.summary && (
                                  <div>
                                    <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                                      <FileText className="w-4 h-4" />
                                      Summary
                                    </h4>
                                    <p className="text-sm text-gray-700 bg-white p-3 rounded-lg border">
                                      {doc.summary}
                                    </p>
                                  </div>
                                )}
                                {doc.keyPoints && parseKeyPoints(doc.keyPoints).length > 0 && (
                                  <div>
                                    <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                                      <CheckCircle className="w-4 h-4" />
                                      Key Points
                                    </h4>
                                    <ul className="space-y-2">
                                      {parseKeyPoints(doc.keyPoints).map((point, idx) => (
                                        <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                                          <span className="text-purple-600 mt-1">•</span>
                                          <span className="flex-1">{point}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </>
                            )}

                            {doc.uploadStatus === 'failed' && doc.errorMessage && (
                              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                                <div className="flex items-start gap-2">
                                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                  <div>
                                    <h4 className="font-semibold text-red-900 mb-1">Processing Failed</h4>
                                    <p className="text-sm text-red-700">{doc.errorMessage}</p>
                                  </div>
                                </div>
                              </div>
                            )}

                            {(doc.uploadStatus === 'pending' || doc.uploadStatus === 'processing') && (
                              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                <div className="flex items-start gap-2">
                                  <Loader2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5 animate-spin" />
                                  <div>
                                    <h4 className="font-semibold text-blue-900 mb-1">
                                      {doc.uploadStatus === 'pending' ? 'Pending' : 'Processing'}
                                    </h4>
                                    <p className="text-sm text-blue-700">
                                      {doc.uploadStatus === 'pending'
                                        ? 'Document is queued for processing'
                                        : 'AI is analyzing the document...'}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="flex justify-end pt-2">
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleDelete(doc.id)}
                                className="gap-2"
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete Document
                              </Button>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

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
