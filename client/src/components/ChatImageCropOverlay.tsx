import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Search, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ChatImageCropOverlayProps {
  imageUrl: string;
  onSearch: (boundingBox?: BoundingBox) => void;
  onSearchFullImage: () => void;
  onCancel: () => void;
  isSearching?: boolean;
  accentColor?: string;
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function ChatImageCropOverlay({
  imageUrl,
  onSearch,
  onSearchFullImage,
  onCancel,
  isSearching = false,
  accentColor = '#D4AF37',
}: ChatImageCropOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [cropBox, setCropBox] = useState<BoundingBox>({ x: 10, y: 10, width: 80, height: 80 });
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeInfo, setResizeInfo] = useState<{
    handle: ResizeHandle;
    startX: number;
    startY: number;
    startBox: BoundingBox;
  } | null>(null);
  const [dragInfo, setDragInfo] = useState<{
    startX: number;
    startY: number;
    startBox: BoundingBox;
  } | null>(null);

  const updateDimensions = useCallback(() => {
    if (imageRef.current && containerRef.current) {
      const img = imageRef.current;
      setImageDimensions({
        width: img.clientWidth,
        height: img.clientHeight,
      });
    }
  }, []);

  useEffect(() => {
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [updateDimensions]);

  const handleResizeStart = (
    e: React.MouseEvent | React.TouchEvent,
    handle: ResizeHandle
  ) => {
    e.stopPropagation();
    e.preventDefault();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setIsResizing(true);
    setResizeInfo({
      handle,
      startX: clientX,
      startY: clientY,
      startBox: { ...cropBox },
    });
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

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setIsDragging(true);
    setDragInfo({
      startX: clientX,
      startY: clientY,
      startBox: { ...cropBox },
    });
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

    setCropBox({
      ...startBox,
      x: newX,
      y: newY,
    });
  }, [dragInfo]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragInfo(null);
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);
      window.addEventListener('touchmove', handleResizeMove);
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
      window.addEventListener('touchmove', handleDragMove);
      window.addEventListener('touchend', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchmove', handleDragMove);
        window.removeEventListener('touchend', handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

  const renderResizeHandles = () => {
    const handles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const handlePositions: Record<ResizeHandle, { top?: string; bottom?: string; left?: string; right?: string; cursor: string }> = {
      nw: { top: '-4px', left: '-4px', cursor: 'nwse-resize' },
      n: { top: '-4px', left: '50%', cursor: 'ns-resize' },
      ne: { top: '-4px', right: '-4px', cursor: 'nesw-resize' },
      e: { top: '50%', right: '-4px', cursor: 'ew-resize' },
      se: { bottom: '-4px', right: '-4px', cursor: 'nwse-resize' },
      s: { bottom: '-4px', left: '50%', cursor: 'ns-resize' },
      sw: { bottom: '-4px', left: '-4px', cursor: 'nesw-resize' },
      w: { top: '50%', left: '-4px', cursor: 'ew-resize' },
    };

    return handles.map((handle) => {
      const pos = handlePositions[handle];
      const isCorner = ['nw', 'ne', 'se', 'sw'].includes(handle);
      
      return (
        <div
          key={handle}
          className="absolute z-20"
          style={{
            ...pos,
            transform: handle === 'n' || handle === 's' 
              ? 'translateX(-50%)' 
              : handle === 'e' || handle === 'w' 
                ? 'translateY(-50%)' 
                : undefined,
            width: isCorner ? '12px' : '8px',
            height: isCorner ? '12px' : '8px',
            backgroundColor: accentColor,
            borderRadius: isCorner ? '2px' : '1px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            cursor: pos.cursor,
          }}
          onMouseDown={(e) => handleResizeStart(e, handle)}
          onTouchStart={(e) => handleResizeStart(e, handle)}
        />
      );
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div 
        className="relative max-w-lg w-full bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
            Select area to search
          </h3>
          <button
            onClick={onCancel}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div 
          ref={containerRef}
          className="relative bg-gray-100 dark:bg-gray-800"
          style={{ touchAction: 'none' }}
        >
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Uploaded image"
            className="w-full h-auto max-h-[50vh] object-contain"
            onLoad={updateDimensions}
            draggable={false}
          />
          
          <div 
            className="absolute inset-0 bg-black/40 pointer-events-none"
            style={{
              clipPath: `polygon(
                0% 0%, 
                0% 100%, 
                ${cropBox.x}% 100%, 
                ${cropBox.x}% ${cropBox.y}%, 
                ${cropBox.x + cropBox.width}% ${cropBox.y}%, 
                ${cropBox.x + cropBox.width}% ${cropBox.y + cropBox.height}%, 
                ${cropBox.x}% ${cropBox.y + cropBox.height}%, 
                ${cropBox.x}% 100%, 
                100% 100%, 
                100% 0%
              )`
            }}
          />

          <div
            className="absolute cursor-move"
            style={{
              left: `${cropBox.x}%`,
              top: `${cropBox.y}%`,
              width: `${cropBox.width}%`,
              height: `${cropBox.height}%`,
              border: `2px solid ${accentColor}`,
              borderRadius: '6px',
              boxShadow: `0 0 0 1px rgba(255,255,255,0.3), 0 0 20px ${accentColor}40`,
            }}
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
          >
            {renderResizeHandles()}
            
            <div 
              className="absolute top-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[10px] font-medium text-white"
              style={{ backgroundColor: accentColor }}
            >
              Drag to move
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isSearching}
            className="flex-1"
          >
            <X className="w-3.5 h-3.5 mr-1.5" />
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onSearchFullImage}
            disabled={isSearching}
            className="flex-1"
          >
            <Maximize2 className="w-3.5 h-3.5 mr-1.5" />
            Full Image
          </Button>
          <Button
            size="sm"
            onClick={() => onSearch(cropBox)}
            disabled={isSearching}
            className="flex-1"
            style={{ backgroundColor: accentColor }}
          >
            <Search className="w-3.5 h-3.5 mr-1.5" />
            {isSearching ? 'Searching...' : 'Search'}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
