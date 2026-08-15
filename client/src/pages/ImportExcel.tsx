import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FileSpreadsheet, Download, Upload, ArrowLeft, CheckCircle, AlertCircle, Loader2, Clock, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import * as XLSX from 'xlsx';

interface ImportJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  totalRows: number;
  processedRows: number;
  successCount: number;
  errorCount: number;
  totalEmbeddings: number;
  processedEmbeddings: number;
  fileName: string | null;
  errors: Array<{ row: number; error: string }> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export default function ImportExcel() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data: recentJobs, refetch: refetchJobs } = useQuery<ImportJob[]>({
    queryKey: ["/api/products/import-jobs"],
    queryFn: async () => {
      const res = await fetch('/api/products/import-jobs', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch import jobs');
      return res.json();
    },
    refetchInterval: 1000,
  });

  const inProgressJob = recentJobs?.find(job => 
    job.status === 'processing' || 
    job.status === 'pending' ||
    (job.totalEmbeddings > 0 && job.processedEmbeddings < job.totalEmbeddings)
  ) || null;

  const activeJob = selectedJobId 
    ? recentJobs?.find(job => job.id === selectedJobId) || inProgressJob
    : inProgressJob;

  useEffect(() => {
    if (activeJob?.status === 'completed' || activeJob?.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    }
  }, [activeJob?.status]);

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Name': 'Example Product 1',
        'Description': 'This is a sample product description',
        'Price': '99.99',
        'Image': 'https://example.com/image1.jpg',
        'Categories': 'Shoes, Accessories',
        'Tags': 'Summer Collection, Bestseller'
      },
      {
        'Name': 'Example Product 2',
        'Description': 'Another sample product',
        'Price': '149.99',
        'Image': '',
        'Categories': 'Clothing',
        'Tags': 'New Arrival'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');

    const columnWidths = [
      { wch: 25 },
      { wch: 40 },
      { wch: 10 },
      { wch: 40 },
      { wch: 30 },
      { wch: 30 }
    ];
    worksheet['!cols'] = columnWidths;

    XLSX.writeFile(workbook, 'product_import_template.xlsx');
    
    toast({
      title: "Template Downloaded",
      description: "Excel template has been downloaded. Fill it with your product data and upload.",
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setSelectedJobId(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/products/import-excel', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start import');
      }

      const result = await response.json();
      setSelectedJobId(result.jobId);
      
      toast({
        title: "Import Started",
        description: `Processing ${result.totalRows} products. You can leave this page - we'll notify you when done!`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to start import",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      const response = await fetch(`/api/products/import-jobs/${jobId}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to cancel import');
      }

      toast({
        title: "Import Cancelled",
        description: "The import job has been cancelled.",
      });
      
      refetchJobs();
      queryClient.invalidateQueries({ queryKey: ["/api/products/import-jobs"] });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'failed':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      case 'cancelled':
        return <XCircle className="h-5 w-5 text-gray-500" />;
      case 'processing':
        return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />;
      default:
        return <Clock className="h-5 w-5 text-yellow-600" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800';
      case 'failed':
        return 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800';
      case 'cancelled':
        return 'bg-gray-50 dark:bg-gray-950/30 border-gray-200 dark:border-gray-800';
      case 'processing':
        return 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800';
      default:
        return 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800';
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  const productProgress = activeJob ? (activeJob.processedRows / activeJob.totalRows) * 100 : 0;
  const embeddingProgress = activeJob && activeJob.totalEmbeddings > 0 
    ? (activeJob.processedEmbeddings / activeJob.totalEmbeddings) * 100 
    : 0;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <Button
        variant="ghost"
        onClick={() => setLocation('/admin/products')}
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Products
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-purple-600" />
            Import Products from Excel
          </CardTitle>
          <CardDescription>
            Upload your Excel file to import up to 100,000 products. Processing happens in the background so you can continue working.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
              Step 1: Download Template
            </h3>
            <p className="text-sm text-blue-800 dark:text-blue-200 mb-4">
              Download our Excel template with the correct format and sample data
            </p>
            <Button
              onClick={handleDownloadTemplate}
              variant="outline"
              className="border-blue-300 dark:border-blue-700"
            >
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
            <h3 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
              Step 2: Fill Your Data
            </h3>
            <div className="text-sm text-purple-800 dark:text-purple-200 space-y-2">
              <p>Open the downloaded template and fill in your product information:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><strong>Name</strong> (required): Product name or title</li>
                <li><strong>Description</strong>: Product description or details</li>
                <li><strong>Price</strong>: Product price (numbers only, no currency symbols)</li>
                <li><strong>Image</strong>: Product image URL (optional)</li>
                <li><strong>Categories</strong> (optional): Comma-separated category names (e.g., "Shoes, Accessories")</li>
                <li><strong>Tags</strong> (optional): Comma-separated tag names (e.g., "Summer Collection, Bestseller")</li>
              </ul>
              <p className="mt-2 text-xs">
                Note: Column names are case-insensitive. You can also use "Product Name" or "Title" for the name column.
              </p>
            </div>
          </div>

          <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <h3 className="font-semibold text-green-900 dark:text-green-100 mb-2">
              Step 3: Upload File
            </h3>
            <p className="text-sm text-green-800 dark:text-green-200 mb-4">
              Select your filled Excel file to import products
            </p>
            <div className="flex items-center gap-4">
              <Button
                onClick={() => document.getElementById('file-upload')?.click()}
                disabled={isUploading || (activeJob?.status === 'processing')}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                <Upload className="h-4 w-4 mr-2" />
                {isUploading ? "Uploading..." : "Upload Excel File"}
              </Button>
              <input
                id="file-upload"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <span className="text-sm text-muted-foreground">
                Supports: .xlsx, .xls, .csv
              </span>
            </div>
          </div>

          {activeJob && (
            <div className={`rounded-lg p-4 border ${getStatusColor(activeJob.status)}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {getStatusIcon(activeJob.status)}
                  <div>
                    <h4 className="font-semibold">
                      {activeJob.status === 'processing' ? 'Import in Progress' : 
                       activeJob.status === 'completed' ? 'Import Completed' :
                       activeJob.status === 'failed' ? 'Import Failed' :
                       activeJob.status === 'cancelled' ? 'Import Cancelled' :
                       'Import Pending'}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      {activeJob.fileName || 'import.xlsx'}
                    </p>
                  </div>
                </div>
                {activeJob.status === 'processing' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCancelJob(activeJob.id)}
                  >
                    Cancel
                  </Button>
                )}
              </div>

              {activeJob.status === 'processing' && (
                <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded-lg p-3 mb-4">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    You can leave this page and explore other sections. We'll notify you when the import is complete!
                  </p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Products Imported</span>
                    <span>{activeJob.processedRows} / {activeJob.totalRows}</span>
                  </div>
                  <Progress value={productProgress} className="h-2" />
                </div>

                {activeJob.totalEmbeddings > 0 && (
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Visual Search Embeddings</span>
                      <span>{activeJob.processedEmbeddings} / {activeJob.totalEmbeddings}</span>
                    </div>
                    <Progress value={embeddingProgress} className="h-2" />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Successful:</span>{' '}
                    <span className="text-green-600 font-medium">{activeJob.successCount}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Errors:</span>{' '}
                    <span className="text-red-600 font-medium">{activeJob.errorCount}</span>
                  </div>
                </div>

                {activeJob.errors && activeJob.errors.length > 0 && (
                  <div className="mt-2 p-3 bg-red-50 dark:bg-red-950/50 rounded border border-red-200 dark:border-red-800">
                    <p className="text-sm font-medium text-red-900 dark:text-red-100 mb-2">
                      Errors ({activeJob.errors.length}):
                    </p>
                    <ul className="text-sm text-red-800 dark:text-red-200 space-y-1 max-h-32 overflow-y-auto">
                      {activeJob.errors.slice(0, 10).map((err, idx) => (
                        <li key={idx}>Row {err.row}: {err.error}</li>
                      ))}
                      {activeJob.errors.length > 10 && (
                        <li className="text-muted-foreground">...and {activeJob.errors.length - 10} more</li>
                      )}
                    </ul>
                  </div>
                )}

                {activeJob.status === 'completed' && (
                  <Button
                    onClick={() => setLocation('/admin/products')}
                    variant="outline"
                    className="mt-2"
                  >
                    View Products
                  </Button>
                )}
              </div>
            </div>
          )}

          {recentJobs && recentJobs.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold mb-3">Recent Imports</h3>
              <div className="space-y-2">
                {recentJobs.slice(0, 5).map(job => (
                  <div 
                    key={job.id}
                    className={`p-3 rounded-lg border flex items-center justify-between cursor-pointer hover:bg-muted/50 ${
                      activeJob?.id === job.id ? 'ring-2 ring-purple-500' : ''
                    }`}
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(job.status)}
                      <div>
                        <p className="text-sm font-medium">{job.fileName || 'import.xlsx'}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.successCount} imported, {job.errorCount} errors
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(job.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
