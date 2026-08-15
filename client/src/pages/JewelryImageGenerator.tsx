import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, Crop, Palette, Sparkles, Download, RefreshCw, X, Check, ArrowRight, ArrowLeft, Camera, ChevronDown, ChevronUp, RotateCcw, Edit3, History, Loader2, Clock, AlertCircle, CheckCircle, Trash2, ZoomIn, Gem, Circle, CircleDot, Link } from 'lucide-react';

// Necklace previews
import necklaceMatteBlack from '@/assets/generated_images/gold_necklace_black_mannequin.png';
import necklaceIvory from '@/assets/generated_images/gold_necklace_ivory_mannequin.png';
import necklaceCharcoal from '@/assets/generated_images/gold_necklace_charcoal_background.png';
import necklaceModelNeck from '@/assets/generated_images/gold_necklace_model_neck.png';

// Ring previews
import ringMatteBlack from '@/assets/generated_images/gold_ring_on_black_background.png';
import ringIvory from '@/assets/generated_images/gold_ring_on_ivory_background.png';
import ringCharcoal from '@/assets/generated_images/gold_ring_on_charcoal_background.png';
import ringModelNeck from '@/assets/generated_images/gold_ring_model_neck.png';

// Bangle previews
import bangleMatteBlack from '@/assets/generated_images/gold_bangles_on_black_background.png';
import bangleIvory from '@/assets/generated_images/gold_bangles_on_ivory_background.png';
import bangleCharcoal from '@/assets/generated_images/gold_bangles_on_charcoal_background.png';
import bangleModelNeck from '@/assets/generated_images/gold_bangles_model_neck.png';

// Bracelet previews
import braceletMatteBlack from '@/assets/generated_images/gold_chain_bracelet_black_background.png';
import braceletIvory from '@/assets/generated_images/gold_chain_bracelet_ivory_background.png';
import braceletCharcoal from '@/assets/generated_images/gold_chain_bracelet_charcoal_background.png';
import braceletModelNeck from '@/assets/generated_images/gold_bracelet_model_neck.png';

// Earring previews
import earringMatteBlack from '@/assets/generated_images/gold_earrings_on_black_background.png';
import earringIvory from '@/assets/generated_images/gold_earrings_on_ivory_background.png';
import earringCharcoal from '@/assets/generated_images/gold_earrings_on_charcoal_background.png';
import earringModelNeck from '@/assets/generated_images/gold_earrings_model_neck.png';

interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Category {
  id: string;
  name: string;
  icon: string;
  description: string;
}

interface Style {
  id: string;
  name: string;
  description: string;
}

interface VistaJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  templateId: string;
  prompt: string;
  originalImageUrl: string;
  generatedImageUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  provider?: 'openai' | 'google';
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const STEPS = [
  { id: 1, title: 'Upload', icon: Upload },
  { id: 2, title: 'Crop', icon: Crop },
  { id: 3, title: 'Template', icon: Palette },
  { id: 4, title: 'Generate', icon: Sparkles },
];

const CATEGORY_STYLE_PREVIEWS: Record<string, Record<string, string>> = {
  'necklaces': {
    'matte-black-mannequin': necklaceMatteBlack,
    'ivory-mannequin': necklaceIvory,
    'charcoal-grey': necklaceCharcoal,
    'model-neck': necklaceModelNeck,
  },
  'rings': {
    'matte-black-mannequin': ringMatteBlack,
    'ivory-mannequin': ringIvory,
    'charcoal-grey': ringCharcoal,
    'model-neck': ringModelNeck,
  },
  'bangles': {
    'matte-black-mannequin': bangleMatteBlack,
    'ivory-mannequin': bangleIvory,
    'charcoal-grey': bangleCharcoal,
    'model-neck': bangleModelNeck,
  },
  'bracelets': {
    'matte-black-mannequin': braceletMatteBlack,
    'ivory-mannequin': braceletIvory,
    'charcoal-grey': braceletCharcoal,
    'model-neck': braceletModelNeck,
  },
  'earrings': {
    'matte-black-mannequin': earringMatteBlack,
    'ivory-mannequin': earringIvory,
    'charcoal-grey': earringCharcoal,
    'model-neck': earringModelNeck,
  },
};

export default function JewelryImageGenerator() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  const [currentStep, setCurrentStep] = useState(1);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [cropBox, setCropBox] = useState<CropBox | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeInfo, setResizeInfo] = useState<{ handle: ResizeHandle; startX: number; startY: number; startBox: CropBox } | null>(null);
  const [dragInfo, setDragInfo] = useState<{ startX: number; startY: number; startBox: CropBox } | null>(null);

  const { data: templatesData } = useQuery<{ categories: Category[]; styles: Style[] }>({
    queryKey: ['/api/jewelry-image-generator/templates'],
    staleTime: 0,
    gcTime: 0,
  });

  const categories = templatesData?.categories || [];
  const styles = templatesData?.styles || [];

  const { data: jobsData, refetch: refetchJobs } = useQuery<{ jobs: VistaJob[] }>({
    queryKey: ['/api/jewelry-image-generator/jobs'],
  });

  const jobs = jobsData?.jobs || [];
  
  const hasPendingJobs = jobs.some(j => j.status === 'pending' || j.status === 'processing');
  
  useEffect(() => {
    if (!hasPendingJobs) return;
    
    const interval = setInterval(() => {
      refetchJobs();
    }, 3000);
    
    return () => clearInterval(interval);
  }, [hasPendingJobs, refetchJobs]);

  const updateDimensions = useCallback(() => {
    if (imageRef.current) {
      setImageDimensions({
        width: imageRef.current.clientWidth,
        height: imageRef.current.clientHeight,
      });
    }
  }, []);

  useEffect(() => {
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [updateDimensions, uploadedImage]);

  useEffect(() => {
    if (uploadedImage && !cropBox) {
      setCropBox({ x: 10, y: 10, width: 80, height: 80 });
    }
  }, [uploadedImage, cropBox]);

  // Fetch prompt when both category and style are selected
  useEffect(() => {
    const fetchPrompt = async () => {
      if (selectedCategory && selectedStyle && (!customPrompt || customPrompt === '')) {
        try {
          const response = await fetch(`/api/jewelry-image-generator/prompt?category=${selectedCategory}&style=${selectedStyle}`, {
            credentials: 'include',
          });
          if (response.ok) {
            const data = await response.json();
            setCustomPrompt(data.prompt || '');
          }
        } catch (error) {
          console.error('Failed to fetch prompt:', error);
        }
      }
    };
    fetchPrompt();
  }, [selectedCategory, selectedStyle]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setUploadedImage(event.target?.result as string);
        setCropBox({ x: 10, y: 10, width: 80, height: 80 });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setUploadedFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setUploadedImage(event.target?.result as string);
        setCropBox({ x: 10, y: 10, width: 80, height: 80 });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent, handle: ResizeHandle) => {
    e.stopPropagation();
    e.preventDefault();
    if (!cropBox) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setIsResizing(true);
    setResizeInfo({ handle, startX: clientX, startY: clientY, startBox: { ...cropBox } });
  };

  const handleResizeMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!resizeInfo || !imageRef.current) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const imgRect = imageRef.current.getBoundingClientRect();
    const deltaXPercent = ((clientX - resizeInfo.startX) / imgRect.width) * 100;
    const deltaYPercent = ((clientY - resizeInfo.startY) / imgRect.height) * 100;

    const { handle, startBox } = resizeInfo;
    let newBox = { ...startBox };
    const minSize = 10;

    switch (handle) {
      case 'nw':
        newBox.x = Math.max(0, Math.min(startBox.x + deltaXPercent, startBox.x + startBox.width - minSize));
        newBox.y = Math.max(0, Math.min(startBox.y + deltaYPercent, startBox.y + startBox.height - minSize));
        newBox.width = startBox.width - (newBox.x - startBox.x);
        newBox.height = startBox.height - (newBox.y - startBox.y);
        break;
      case 'n':
        newBox.y = Math.max(0, Math.min(startBox.y + deltaYPercent, startBox.y + startBox.height - minSize));
        newBox.height = startBox.height - (newBox.y - startBox.y);
        break;
      case 'ne':
        newBox.y = Math.max(0, Math.min(startBox.y + deltaYPercent, startBox.y + startBox.height - minSize));
        newBox.width = Math.max(minSize, Math.min(startBox.width + deltaXPercent, 100 - startBox.x));
        newBox.height = startBox.height - (newBox.y - startBox.y);
        break;
      case 'e':
        newBox.width = Math.max(minSize, Math.min(startBox.width + deltaXPercent, 100 - startBox.x));
        break;
      case 'se':
        newBox.width = Math.max(minSize, Math.min(startBox.width + deltaXPercent, 100 - startBox.x));
        newBox.height = Math.max(minSize, Math.min(startBox.height + deltaYPercent, 100 - startBox.y));
        break;
      case 's':
        newBox.height = Math.max(minSize, Math.min(startBox.height + deltaYPercent, 100 - startBox.y));
        break;
      case 'sw':
        newBox.x = Math.max(0, Math.min(startBox.x + deltaXPercent, startBox.x + startBox.width - minSize));
        newBox.width = startBox.width - (newBox.x - startBox.x);
        newBox.height = Math.max(minSize, Math.min(startBox.height + deltaYPercent, 100 - startBox.y));
        break;
      case 'w':
        newBox.x = Math.max(0, Math.min(startBox.x + deltaXPercent, startBox.x + startBox.width - minSize));
        newBox.width = startBox.width - (newBox.x - startBox.x);
        break;
    }

    setCropBox(newBox);
  }, [resizeInfo]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    setResizeInfo(null);
  }, []);

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!cropBox) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setIsDragging(true);
    setDragInfo({ startX: clientX, startY: clientY, startBox: { ...cropBox } });
  };

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragInfo || !imageRef.current) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const imgRect = imageRef.current.getBoundingClientRect();
    const deltaXPercent = ((clientX - dragInfo.startX) / imgRect.width) * 100;
    const deltaYPercent = ((clientY - dragInfo.startY) / imgRect.height) * 100;

    const { startBox } = dragInfo;
    let newX = startBox.x + deltaXPercent;
    let newY = startBox.y + deltaYPercent;
    
    newX = Math.max(0, Math.min(newX, 100 - startBox.width));
    newY = Math.max(0, Math.min(newY, 100 - startBox.height));

    setCropBox({ ...startBox, x: newX, y: newY });
  }, [dragInfo]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragInfo(null);
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);
      window.addEventListener('touchmove', handleResizeMove, { passive: false });
      window.addEventListener('touchend', handleResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', handleResizeEnd);
        window.removeEventListener('touchmove', handleResizeMove);
        window.removeEventListener('touchend', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove, { passive: false });
      window.addEventListener('touchend', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchmove', handleDragMove);
        window.removeEventListener('touchend', handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  const handleGenerate = async () => {
    if (!uploadedImage || !selectedCategory || !selectedStyle) return;

    setIsGenerating(true);
    setGenerationProgress(0);

    try {
      const formData = new FormData();
      if (uploadedFile) {
        formData.append('image', uploadedFile);
      } else {
        formData.append('imageDataUrl', uploadedImage);
      }
      // Template format: category-style (e.g., "necklaces-matte-black-mannequin")
      formData.append('template', `${selectedCategory}-${selectedStyle}`);
      if (cropBox) {
        formData.append('cropBox', JSON.stringify(cropBox));
      }
      if (customPrompt) {
        formData.append('customPrompt', customPrompt);
      }

      const response = await fetch('/api/jewelry-image-generator/jobs', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start generation');
      }

      const result = await response.json();
      setCurrentJobId(result.jobId);
      setCurrentStep(4);
      
      await refetchJobs();
      
      toast({
        title: 'Generation Started',
        description: 'Your image is being generated. You can check the History tab for progress.',
      });
    } catch (error: any) {
      toast({
        title: 'Generation Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Poll for current job completion
  useEffect(() => {
    if (!currentJobId) return;

    const currentJob = jobs.find(j => j.id === currentJobId);
    if (currentJob?.status === 'completed' && currentJob.generatedImageUrl) {
      setGeneratedImage(currentJob.generatedImageUrl);
      setGenerationProgress(100);
      toast({
        title: 'Image Generated',
        description: 'Your professional product image is ready.',
      });
    } else if (currentJob?.status === 'failed') {
      toast({
        title: 'Generation Failed',
        description: currentJob.errorMessage || 'Unknown error occurred',
        variant: 'destructive',
      });
      setCurrentJobId(null);
    } else if (currentJob?.status === 'processing') {
      setGenerationProgress(50);
    }
  }, [jobs, currentJobId, toast]);

  const handleDeleteJob = async (jobId: string) => {
    try {
      await fetch(`/api/jewelry-image-generator/jobs/${jobId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      refetchJobs();
      toast({
        title: 'Deleted',
        description: 'Image removed from history.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete job.',
        variant: 'destructive',
      });
    }
  };

  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  const handleRetryJob = async (jobId: string) => {
    setRetryingJobId(jobId);
    try {
      const response = await fetch(`/api/jewelry-image-generator/jobs/${jobId}/retry`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok) {
        refetchJobs();
        toast({
          title: 'Retrying',
          description: 'A new generation job has been started.',
        });
      } else {
        toast({
          title: 'Retry Failed',
          description: data.error || 'Failed to retry generation.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to retry job.',
        variant: 'destructive',
      });
    } finally {
      setRetryingJobId(null);
    }
  };

  const handleDownload = () => {
    if (!generatedImage) return;
    
    const link = document.createElement('a');
    link.href = generatedImage;
    link.download = `jewelry-product-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleReset = () => {
    setCurrentStep(1);
    setUploadedImage(null);
    setUploadedFile(null);
    setCropBox(null);
    setSelectedCategory(null);
    setSelectedStyle(null);
    setCustomPrompt('');
    setShowPromptEditor(false);
    setGeneratedImage(null);
    setGenerationProgress(0);
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1: return !!uploadedImage;
      case 2: return !!cropBox;
      case 3: return !!selectedCategory && !!selectedStyle;
      default: return false;
    }
  };

  const renderResizeHandles = () => {
    if (!cropBox) return null;

    const handles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const handlePositions: Record<ResizeHandle, React.CSSProperties> = {
      nw: { top: -5, left: -5, cursor: 'nwse-resize' },
      n: { top: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
      ne: { top: -5, right: -5, cursor: 'nesw-resize' },
      e: { top: '50%', right: -5, transform: 'translateY(-50%)', cursor: 'ew-resize' },
      se: { bottom: -5, right: -5, cursor: 'nwse-resize' },
      s: { bottom: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
      sw: { bottom: -5, left: -5, cursor: 'nesw-resize' },
      w: { top: '50%', left: -5, transform: 'translateY(-50%)', cursor: 'ew-resize' },
    };

    return handles.map(handle => (
      <div
        key={handle}
        className="absolute w-2.5 h-2.5 bg-white rounded-full border border-purple-500 shadow-sm z-20 hover:scale-125 transition-transform"
        style={handlePositions[handle]}
        onMouseDown={(e) => handleResizeStart(e, handle)}
        onTouchStart={(e) => handleResizeStart(e, handle)}
      />
    ));
  };

  const stepDescriptions: Record<number, string> = {
    1: 'Upload a high-quality image of your jewelry piece',
    2: 'Adjust the selection to focus on the jewelry',
    3: 'Select a professional background template',
    4: 'Your studio-quality image is ready',
  };

  const pendingJobsCount = jobs.filter(j => j.status === 'pending' || j.status === 'processing').length;

  const getStatusIcon = (status: VistaJob['status']) => {
    switch (status) {
      case 'pending':
      case 'processing':
        return <Loader2 className="w-4 h-4 animate-spin text-purple-500" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const getStatusText = (status: VistaJob['status']) => {
    switch (status) {
      case 'pending':
        return 'Queued';
      case 'processing':
        return 'Generating...';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
    }
  };

  return (
    <div className="p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-100 to-purple-50 flex items-center justify-center">
              <Camera className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Vista Studio</h1>
              <p className="text-gray-500 text-sm">Create professional product photography</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant={activeTab === 'create' ? 'default' : 'outline'}
              onClick={() => setActiveTab('create')}
              className={activeTab === 'create' ? 'bg-purple-600 hover:bg-purple-700' : ''}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Create
            </Button>
            <Button
              variant={activeTab === 'history' ? 'default' : 'outline'}
              onClick={() => setActiveTab('history')}
              className={activeTab === 'history' ? 'bg-purple-600 hover:bg-purple-700' : ''}
            >
              <History className="w-4 h-4 mr-2" />
              History
              {pendingJobsCount > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">
                  {pendingJobsCount}
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>

      {activeTab === 'history' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Generation History</h2>
          {jobs.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <History className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No images generated yet</p>
              <p className="text-sm mt-1">Create your first image to see it here</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {jobs.map((job) => (
                <div key={job.id} className="border border-gray-200 rounded-xl overflow-hidden group">
                  <div className="relative aspect-square bg-gray-100">
                    {(job.status === 'pending' || job.status === 'processing') ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <img 
                          src={job.originalImageUrl} 
                          alt="Processing"
                          className="absolute inset-0 w-full h-full object-cover opacity-50"
                        />
                        <div className="relative z-10 bg-white/90 backdrop-blur-sm rounded-xl p-4 shadow-lg">
                          <Loader2 className="w-8 h-8 animate-spin text-purple-500 mx-auto mb-2" />
                          <p className="text-sm font-medium text-gray-700">Generating...</p>
                          <p className="text-xs text-gray-500">This may take 15-30 seconds</p>
                        </div>
                      </div>
                    ) : job.status === 'completed' && job.generatedImageUrl ? (
                      <div 
                        className="relative w-full h-full group cursor-pointer"
                        onClick={() => setLightboxImage(job.generatedImageUrl!)}
                      >
                        <img 
                          src={job.generatedImageUrl} 
                          alt="Generated"
                          className="w-full h-full object-cover"
                        />
                        {job.originalImageUrl && (
                          <div 
                            className="absolute bottom-2 left-2 w-16 h-16 rounded-lg border-2 border-white shadow-lg overflow-hidden cursor-pointer hover:scale-110 transition-transform"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightboxImage(job.originalImageUrl);
                            }}
                            title="View original image"
                          >
                            <img 
                              src={job.originalImageUrl} 
                              alt="Original"
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                              <span className="text-[8px] font-medium text-white bg-black/50 px-1 rounded">Original</span>
                            </div>
                          </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 pointer-events-none">
                          <div className="bg-white/90 backdrop-blur-sm rounded-full p-2 shadow-lg">
                            <ZoomIn className="w-5 h-5 text-gray-700" />
                          </div>
                        </div>
                      </div>
                    ) : job.status === 'failed' ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-50">
                        <AlertCircle className="w-8 h-8 text-red-400 mb-2" />
                        <p className="text-sm text-red-600">Failed</p>
                        <p className="text-xs text-red-500 px-4 text-center">{job.errorMessage}</p>
                      </div>
                    ) : (
                      <img 
                        src={job.originalImageUrl} 
                        alt="Original"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(job.status)}
                        <span className="text-sm text-gray-600">{getStatusText(job.status)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {job.status === 'completed' && job.generatedImageUrl && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const link = document.createElement('a');
                              link.href = job.generatedImageUrl!;
                              link.download = `vista-studio-${job.id}.png`;
                              link.click();
                            }}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        )}
                        {job.status === 'failed' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRetryJob(job.id)}
                            disabled={retryingJobId === job.id}
                            className="text-purple-500 hover:text-purple-600 hover:bg-purple-50"
                            title="Retry generation"
                          >
                            {retryingJobId === job.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RefreshCw className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteJob(job.id)}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(job.createdAt).toLocaleDateString()} {new Date(job.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'create' && (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <p className="text-gray-600 text-sm">
            {stepDescriptions[currentStep]}
          </p>
          <div className="flex items-center gap-2">
            {STEPS.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300 ${
                    currentStep > step.id
                      ? 'bg-purple-500 text-white'
                      : currentStep === step.id
                      ? 'bg-purple-100 border-2 border-purple-500 text-purple-600'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                  title={step.title}
                >
                  {currentStep > step.id ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <step.icon className="w-4 h-4" />
                  )}
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    className={`w-8 h-0.5 mx-1 transition-colors duration-300 ${
                      currentStep > step.id ? 'bg-purple-500' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6">
          {currentStep === 1 && (
            <div
              className={`relative rounded-xl transition-all duration-300 cursor-pointer group ${
                uploadedImage 
                  ? 'bg-gray-50' 
                  : 'bg-gray-50 hover:bg-gray-100 border-2 border-dashed border-gray-200 hover:border-purple-300'
              }`}
              style={{ minHeight: uploadedImage ? 'auto' : '280px' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => !uploadedImage && document.getElementById('file-upload')?.click()}
            >
              {uploadedImage ? (
                <div className="relative p-4">
                  <img
                    src={uploadedImage}
                    alt="Uploaded jewelry"
                    className="max-h-[400px] mx-auto rounded-lg"
                  />
                  <button
                    className="absolute top-6 right-6 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-md hover:bg-gray-50 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setUploadedImage(null);
                      setUploadedFile(null);
                    }}
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
                  <div className="w-14 h-14 rounded-full bg-purple-100 flex items-center justify-center mb-4 group-hover:bg-purple-200 transition-colors">
                    <Upload className="w-6 h-6 text-purple-600" />
                  </div>
                  <p className="text-gray-700 font-medium mb-1">
                    Drop your image here
                  </p>
                  <p className="text-gray-500 text-sm">
                    or click to browse
                  </p>
                  <p className="text-gray-400 text-xs mt-3">
                    Supports JPG, PNG, WEBP
                  </p>
                </div>
              )}
              <input
                id="file-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          )}

          {currentStep === 2 && uploadedImage && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500 text-center">
                Drag the corners to adjust the selection area
              </p>
              <div
                ref={containerRef}
                className="relative flex justify-center mx-auto overflow-hidden rounded-xl bg-gray-50"
                style={{ userSelect: 'none' }}
              >
                <img
                  ref={imageRef}
                  src={uploadedImage}
                  alt="Crop preview"
                  className="max-h-[400px] w-auto"
                  onLoad={updateDimensions}
                  draggable={false}
                />
                <div
                  className="absolute inset-0 bg-black/30 pointer-events-none"
                  style={{
                    clipPath: cropBox
                      ? `polygon(
                          0 0, 100% 0, 100% 100%, 0 100%, 0 0,
                          ${cropBox.x}% ${cropBox.y}%,
                          ${cropBox.x}% ${cropBox.y + cropBox.height}%,
                          ${cropBox.x + cropBox.width}% ${cropBox.y + cropBox.height}%,
                          ${cropBox.x + cropBox.width}% ${cropBox.y}%,
                          ${cropBox.x}% ${cropBox.y}%
                        )`
                      : 'none',
                  }}
                />
                {cropBox && (
                  <div
                    className="absolute border-2 border-purple-500 bg-transparent cursor-move shadow-lg"
                    style={{
                      left: `${cropBox.x}%`,
                      top: `${cropBox.y}%`,
                      width: `${cropBox.width}%`,
                      height: `${cropBox.height}%`,
                    }}
                    onMouseDown={handleDragStart}
                    onTouchStart={handleDragStart}
                  >
                    {renderResizeHandles()}
                  </div>
                )}
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-6">
              {/* Category Selection */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-700">Select Jewelry Category</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {categories.map((category) => {
                    const isSelected = selectedCategory === category.id;
                    const IconComponent = category.icon === 'gem' ? Gem : 
                                         category.icon === 'circle' ? Circle :
                                         category.icon === 'circle-dot' ? CircleDot :
                                         category.icon === 'link' ? Link : Sparkles;
                    return (
                      <div
                        key={category.id}
                        className={`relative cursor-pointer rounded-xl p-4 transition-all duration-300 ${
                          isSelected
                            ? 'bg-purple-50 border-2 border-purple-500 shadow-md'
                            : 'bg-gray-50 border-2 border-gray-200 hover:border-purple-300 hover:bg-purple-50/50'
                        }`}
                        onClick={() => {
                          setSelectedCategory(category.id);
                          setSelectedStyle(null);
                          setCustomPrompt('');
                          setShowPromptEditor(false);
                        }}
                      >
                        <div className="flex flex-col items-center text-center gap-2">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            isSelected ? 'bg-purple-500 text-white' : 'bg-gray-200 text-gray-600'
                          }`}>
                            <IconComponent className="w-5 h-5" />
                          </div>
                          <div>
                            <p className={`font-medium text-sm ${isSelected ? 'text-purple-700' : 'text-gray-900'}`}>
                              {category.name}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">{category.description}</p>
                          </div>
                        </div>
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Style Selection - Only shown after category is selected */}
              {selectedCategory && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-gray-700">Select Background Style</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {styles.map((style) => {
                      const previewImage = selectedCategory ? CATEGORY_STYLE_PREVIEWS[selectedCategory]?.[style.id] : null;
                      const isSelected = selectedStyle === style.id;
                      return (
                        <div
                          key={style.id}
                          className={`relative cursor-pointer rounded-xl overflow-hidden transition-all duration-300 group ${
                            isSelected
                              ? 'ring-2 ring-purple-500 shadow-lg'
                              : 'border border-gray-200 hover:border-purple-300 hover:shadow-md'
                          }`}
                          onClick={async () => {
                            setSelectedStyle(style.id);
                            setShowPromptEditor(false);
                            // Fetch the prompt for this category+style combination
                            try {
                              const response = await fetch(`/api/jewelry-image-generator/prompt?category=${selectedCategory}&style=${style.id}`, {
                                credentials: 'include',
                              });
                              if (response.ok) {
                                const data = await response.json();
                                setCustomPrompt(data.prompt || '');
                              }
                            } catch (error) {
                              console.error('Failed to fetch prompt:', error);
                            }
                          }}
                        >
                          <div className="aspect-square relative overflow-hidden">
                            {previewImage ? (
                              <img
                                src={previewImage}
                                alt={style.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div
                                className="w-full h-full flex items-center justify-center bg-gray-100"
                              />
                            )}
                            {isSelected && (
                              <div className="absolute top-2 right-2 w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center">
                                <Check className="w-3.5 h-3.5 text-white" />
                              </div>
                            )}
                          </div>
                          <div className="p-3 bg-white">
                            <p className="font-medium text-gray-900 text-sm">{style.name}</p>
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                              {style.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedCategory && selectedStyle && (
                <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-100 transition-colors"
                    onClick={() => setShowPromptEditor(!showPromptEditor)}
                  >
                    <div className="flex items-center gap-2">
                      <Edit3 className="w-4 h-4 text-purple-600" />
                      <span className="text-sm font-medium text-gray-700">
                        AI Prompt
                      </span>
                      <span className="text-xs text-gray-400">
                        ({customPrompt.length}/1000 characters)
                      </span>
                    </div>
                    {showPromptEditor ? (
                      <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                  
                  {showPromptEditor && (
                    <div className="px-4 pb-4 space-y-3">
                      <textarea
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value.slice(0, 1000))}
                        className="w-full h-32 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                        placeholder="Describe how you want the jewelry to be displayed..."
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500">
                          Edit the prompt to customize how DALL-E generates your image
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            if (selectedCategory && selectedStyle) {
                              try {
                                const response = await fetch(`/api/jewelry-image-generator/prompt?category=${selectedCategory}&style=${selectedStyle}`, {
                                  credentials: 'include',
                                });
                                if (response.ok) {
                                  const data = await response.json();
                                  setCustomPrompt(data.prompt || '');
                                }
                              } catch (error) {
                                console.error('Failed to fetch prompt:', error);
                              }
                            }
                          }}
                          className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          Reset to default
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {currentStep === 4 && (
            <div className="text-center">
              {(() => {
                const currentJob = currentJobId ? jobs.find(j => j.id === currentJobId) : null;
                const isJobProcessing = currentJob && (currentJob.status === 'pending' || currentJob.status === 'processing');
                const showGeneratingAnimation = isGenerating || isJobProcessing;
                
                if (showGeneratingAnimation) {
                  return (
                    <div className="py-12">
                      <div className="relative w-24 h-24 mx-auto mb-6">
                        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 animate-pulse opacity-30" />
                        <div className="absolute inset-2 rounded-full bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center">
                          <div className="relative">
                            <Sparkles className="w-10 h-10 text-purple-600 animate-pulse" />
                            <div className="absolute inset-0 animate-spin" style={{ animationDuration: '3s' }}>
                              <div className="absolute top-0 left-1/2 w-1 h-1 bg-purple-500 rounded-full transform -translate-x-1/2 -translate-y-2" />
                            </div>
                          </div>
                        </div>
                        <div className="absolute inset-0 rounded-full border-2 border-purple-300 border-t-purple-600 animate-spin" style={{ animationDuration: '1.5s' }} />
                      </div>
                      <p className="text-lg text-gray-700 font-medium mb-2">
                        AI is creating your image...
                      </p>
                      <p className="text-sm text-gray-500 mb-4">
                        Chroney Vista is generating professional product photography
                      </p>
                      <div className="max-w-xs mx-auto">
                        <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-purple-600 rounded-full transition-all duration-500"
                            style={{ width: `${generationProgress}%` }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 mt-3">
                        This may take 30-60 seconds
                      </p>
                      
                      <div className="mt-8 pt-6 border-t border-gray-100">
                        <p className="text-sm text-gray-500 mb-4">
                          You can navigate away — your image will be waiting in History when it's ready
                        </p>
                        <Button 
                          variant="outline" 
                          onClick={handleReset}
                          className="border-gray-300 text-gray-600 hover:bg-gray-50"
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Create Another Image
                        </Button>
                      </div>
                    </div>
                  );
                }
                
                if (generatedImage) {
                  return (
                    <div className="space-y-6">
                      <div 
                        className="relative inline-block group cursor-pointer"
                        onClick={() => setLightboxImage(generatedImage)}
                      >
                        <img
                          src={generatedImage}
                          alt="Generated product"
                          className="max-h-[400px] mx-auto rounded-xl shadow-xl transition-transform group-hover:scale-[1.02]"
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded-xl">
                          <div className="bg-white/90 backdrop-blur-sm rounded-full p-3 shadow-lg">
                            <ZoomIn className="w-6 h-6 text-gray-700" />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-center gap-3 pt-2">
                        <Button 
                          onClick={handleDownload} 
                          className="bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-700 hover:to-purple-600 text-white px-6"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={handleReset} 
                          className="border-gray-300 text-gray-600 hover:bg-gray-50"
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Create Another
                        </Button>
                      </div>
                    </div>
                  );
                }
                
                return null;
              })()}
            </div>
          )}
        </div>

        {currentStep < 4 && !isGenerating && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
            <Button
              variant="ghost"
              onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
              disabled={currentStep === 1}
              className="text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            
            {currentStep === 3 ? (
              <Button
                onClick={handleGenerate}
                disabled={!canProceed()}
                className="bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-700 hover:to-purple-600 text-white px-6 disabled:opacity-40"
              >
                Generate Image
                <Sparkles className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button
                onClick={() => setCurrentStep(Math.min(4, currentStep + 1))}
                disabled={!canProceed()}
                className="bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-700 hover:to-purple-600 text-white px-6 disabled:opacity-40"
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        )}
      </div>
      )}

      {lightboxImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <img
            src={lightboxImage}
            alt="Full size preview"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
            <Button
              onClick={(e) => {
                e.stopPropagation();
                const link = document.createElement('a');
                link.href = lightboxImage;
                link.download = `vista-studio-${Date.now()}.png`;
                link.click();
              }}
              className="bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm"
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
