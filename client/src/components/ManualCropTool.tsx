import React, { useState, useCallback } from 'react';
import Cropper, { Area, Point } from 'react-easy-crop';
import { Button } from '@/components/ui/button';
import { Crop, X, Check, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

interface ManualCropToolProps {
  imageUrl: string;
  onCropComplete: (croppedAreaPixels: Area) => void;
  onCancel: () => void;
  isSearching?: boolean;
  theme: {
    text: string;
    textMuted: string;
    accent: string;
    glassBg: string;
    glassBorder: string;
    cardBg: string;
  };
}

export function ManualCropTool({ 
  imageUrl, 
  onCropComplete, 
  onCancel,
  isSearching = false,
  theme 
}: ManualCropToolProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const onCropChange = useCallback((location: Point) => {
    setCrop(location);
  }, []);

  const onZoomChange = useCallback((newZoom: number) => {
    setZoom(newZoom);
  }, []);

  const onCropCompleteHandler = useCallback(
    (_croppedArea: Area, croppedAreaPixels: Area) => {
      setCroppedAreaPixels(croppedAreaPixels);
    },
    []
  );

  const handleConfirm = useCallback(() => {
    if (croppedAreaPixels) {
      onCropComplete(croppedAreaPixels);
    }
  }, [croppedAreaPixels, onCropComplete]);

  const handleReset = useCallback(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="relative flex-1 min-h-[300px] sm:min-h-[400px]">
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          aspect={undefined}
          onCropChange={onCropChange}
          onZoomChange={onZoomChange}
          onCropComplete={onCropCompleteHandler}
          style={{
            containerStyle: {
              backgroundColor: theme.cardBg,
              borderRadius: '12px',
            },
            cropAreaStyle: {
              border: `3px solid ${theme.accent}`,
              boxShadow: `0 0 0 9999px rgba(0,0,0,0.5)`,
            },
          }}
          showGrid={true}
          objectFit="contain"
        />
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <ZoomOut className="w-4 h-4 flex-shrink-0" style={{ color: theme.textMuted }} />
          <Slider
            value={[zoom]}
            onValueChange={([value]) => setZoom(value)}
            min={1}
            max={3}
            step={0.1}
            className="flex-1"
          />
          <ZoomIn className="w-4 h-4 flex-shrink-0" style={{ color: theme.textMuted }} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="flex items-center gap-2"
            style={{ borderColor: theme.glassBorder, color: theme.text }}
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </Button>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={isSearching}
              className="flex items-center gap-2"
              style={{ borderColor: theme.glassBorder, color: theme.text }}
            >
              <X className="w-4 h-4" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!croppedAreaPixels || isSearching}
              className="flex items-center gap-2"
              style={{ 
                background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent}cc)`,
                color: '#fff'
              }}
            >
              {isSearching ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Search This Area
                </>
              )}
            </Button>
          </div>
        </div>

        <p className="text-xs text-center" style={{ color: theme.textMuted }}>
          Drag to position, pinch or use slider to zoom. Select the jewelry area you want to search for.
        </p>
      </div>
    </div>
  );
}

export default ManualCropTool;
