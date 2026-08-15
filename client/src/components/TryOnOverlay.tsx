import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, Upload, Sparkles, Download, Share2, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TryOnOverlayProps {
  productImage: string;
  productName: string;
  productType?: string;
  businessAccountId: string;
  onClose: () => void;
  onResult?: (resultImageUrl: string) => void;
  accentColor?: string;
}

type Step = 'upload' | 'processing' | 'result';

export function TryOnOverlay({
  productImage,
  productName,
  productType = 'necklace',
  businessAccountId,
  onClose,
  onResult,
  accentColor = '#D4AF37',
}: TryOnOverlayProps) {
  const [step, setStep] = useState<Step>('upload');
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be less than 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setSelfiePreview(event.target?.result as string);
      setError(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleTryOn = useCallback(async () => {
    if (!selfiePreview) {
      setError('Please upload a photo first');
      return;
    }

    setIsProcessing(true);
    setStep('processing');
    setError(null);

    try {
      const response = await fetch('/api/chat/widget/try-on', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          businessAccountId,
          selfieDataUrl: selfiePreview,
          productImageUrl: productImage,
          productName,
          productType,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Try-on failed');
      }

      setResultImage(data.tryOnImageUrl);
      setStep('result');
      onResult?.(data.tryOnImageUrl);
    } catch (err: any) {
      setError(err.message || 'Failed to generate try-on image');
      setStep('upload');
    } finally {
      setIsProcessing(false);
    }
  }, [selfiePreview, businessAccountId, productImage, productName, productType, onResult]);

  const handleDownload = useCallback(() => {
    if (!resultImage) return;

    const link = document.createElement('a');
    link.href = resultImage;
    link.download = `try-on-${productName.replace(/\s+/g, '-').toLowerCase()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [resultImage, productName]);

  const handleShare = useCallback(async () => {
    if (!resultImage) return;

    try {
      const response = await fetch(resultImage);
      const blob = await response.blob();
      const file = new File([blob], `try-on-${productName}.png`, { type: 'image/png' });

      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Virtual Try-On: ${productName}`,
          files: [file],
        });
      } else {
        await navigator.clipboard.writeText(resultImage.substring(0, 100) + '...');
        alert('Image link copied to clipboard!');
      }
    } catch (err) {
      console.error('Share failed:', err);
    }
  }, [resultImage, productName]);


  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex flex-col bg-black/70"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative w-full h-full bg-white overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ backgroundColor: accentColor }}
        >
          <div className="flex items-center gap-2 text-white">
            <Sparkles className="w-5 h-5" />
            <span className="font-semibold">Virtual Try-On</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <AnimatePresence mode="wait">
            {step === 'upload' && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div className="flex gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-500 mb-2">Product</p>
                    <div className="relative rounded-lg overflow-hidden bg-gray-100 border" style={{ height: '144px' }}>
                      <img
                        src={productImage}
                        alt={productName}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <p className="text-xs text-gray-600 mt-1 truncate">{productName}</p>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-500 mb-2">Your Photo</p>
                    <div
                      className="relative rounded-lg overflow-hidden bg-gray-100 border-2 border-dashed cursor-pointer hover:bg-gray-50 transition-colors"
                      style={{ height: '144px', borderColor: selfiePreview ? accentColor : '#d1d5db' }}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {selfiePreview ? (
                        <img
                          src={selfiePreview}
                          alt="Your photo"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                          <Upload className="w-8 h-8 mb-2" />
                          <span className="text-xs">Upload Photo</span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Tap to change</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    className="hidden"
                    onChange={handleFileSelect}
                  />

                  <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4" />
                    Gallery
                  </Button>

                  <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="w-4 h-4" />
                    Camera
                  </Button>
                </div>

                {error && (
                  <p className="text-sm text-red-500 text-center">{error}</p>
                )}

                <Button
                  className="w-full gap-2"
                  style={{ backgroundColor: accentColor }}
                  disabled={!selfiePreview || isProcessing}
                  onClick={handleTryOn}
                >
                  <Sparkles className="w-4 h-4" />
                  Try It On
                </Button>

                <p className="text-xs text-gray-400 text-center">
                  Your photo is processed securely and not stored
                </p>
              </motion.div>
            )}

            {step === 'processing' && (
              <motion.div
                key="processing"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="py-12 flex flex-col items-center justify-center"
              >
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                  style={{ backgroundColor: `${accentColor}20` }}
                >
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: accentColor }} />
                </div>
                <p className="text-lg font-medium text-gray-800">Creating your look...</p>
                <p className="text-sm text-gray-500 mt-1">This may take a few seconds</p>
              </motion.div>
            )}

            {step === 'result' && resultImage && !isExpanded && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div 
                  className="relative rounded-lg overflow-hidden bg-gray-100 cursor-pointer group mx-auto"
                  style={{ maxWidth: '200px' }}
                  onClick={() => setIsExpanded(true)}
                >
                  <img
                    src={resultImage}
                    alt="Try-on result"
                    className="w-full h-auto"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="bg-white/90 rounded-full p-2">
                      <Maximize2 className="w-5 h-5 text-gray-700" />
                    </div>
                  </div>
                  <div className="absolute bottom-2 right-2 bg-white/90 rounded-full p-1.5 shadow-md">
                    <Maximize2 className="w-4 h-4 text-gray-600" />
                  </div>
                </div>

                <p className="text-center text-sm text-gray-600">
                  Here's how <span className="font-medium">{productName}</span> looks on you!
                </p>
                <p className="text-center text-xs text-gray-400">Tap image to enlarge</p>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={handleDownload}
                  >
                    <Download className="w-4 h-4" />
                    Save
                  </Button>

                  <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={handleShare}
                  >
                    <Share2 className="w-4 h-4" />
                    Share
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 'result' && resultImage && isExpanded && (
              <motion.div
                key="result-expanded"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute inset-0 bg-black flex flex-col"
              >
                <div className="flex items-center justify-between p-3 bg-black/80">
                  <p className="text-white text-sm font-medium truncate flex-1">{productName}</p>
                  <button
                    onClick={() => setIsExpanded(false)}
                    className="p-2 rounded-full hover:bg-white/20 transition-colors"
                  >
                    <Minimize2 className="w-5 h-5 text-white" />
                  </button>
                </div>
                <div className="flex-1 flex items-center justify-center overflow-auto p-2">
                  <img
                    src={resultImage}
                    alt="Try-on result"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                <div className="flex gap-2 p-3 bg-black/80">
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 bg-white/10 border-white/30 text-white hover:bg-white/20"
                    onClick={handleDownload}
                  >
                    <Download className="w-4 h-4" />
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 gap-2 bg-white/10 border-white/30 text-white hover:bg-white/20"
                    onClick={handleShare}
                  >
                    <Share2 className="w-4 h-4" />
                    Share
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
