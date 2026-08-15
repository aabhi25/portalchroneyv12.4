import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  bottomAnchorY?: number;
}

interface DetectedItem {
  type: string;
  croppedDataUrl: string | null;
  confidence: number;
  description?: string;
  boundingBox?: BoundingBox | null;
  attributes?: any;
}

interface AdjustedBoundaries {
  [index: number]: BoundingBox;
}

interface DetectedJewelryOverlayProps {
  imageUrl: string;
  detectedItems: DetectedItem[];
  imageWidth?: number;
  imageHeight?: number;
  selectedIndex: number | null;
  onSelectItem: (index: number) => void;
  onSearchItem: (item: DetectedItem, adjustedBox?: BoundingBox) => void;
  onSearchAllItems: (items: Array<{ item: DetectedItem; adjustedBox?: BoundingBox }>) => void;
  onClearSearch: () => void;
  onManualCrop: () => void;
  theme: any;
  isSearching?: boolean;
}

const typeColors: Record<string, string> = {
  necklace: '#8B5CF6',
  'earring-pair': '#EC4899',
  earring: '#EC4899',
  ring: '#F59E0B',
  bracelet: '#10B981',
  bangle: '#06B6D4',
  pendant: '#6366F1',
  chain: '#84CC16',
  anklet: '#F97316',
  brooch: '#A855F7',
  'maang-tikka': '#E11D48',
  'nose-ring': '#14B8A6',
  'waist-chain': '#EAB308',
};

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function DetectedJewelryOverlay({
  imageUrl,
  detectedItems,
  selectedIndex,
  onSelectItem,
  onSearchItem,
  onSearchAllItems,
  onClearSearch,
  onManualCrop,
  theme,
  isSearching = false,
}: DetectedJewelryOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [adjustedBoundaries, setAdjustedBoundaries] = useState<AdjustedBoundaries>({});
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeInfo, setResizeInfo] = useState<{
    index: number;
    handle: ResizeHandle;
    startX: number;
    startY: number;
    startBox: BoundingBox;
  } | null>(null);
  const [dragInfo, setDragInfo] = useState<{
    index: number;
    startX: number;
    startY: number;
    startBox: BoundingBox;
  } | null>(null);
  const [adjustedCroppedImages, setAdjustedCroppedImages] = useState<{ [index: number]: string }>({});
  const [hiddenIndices, setHiddenIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    setHiddenIndices(new Set());
  }, [detectedItems]);

  const visibleItems = useMemo(() => {
    return detectedItems.map((item, index) => ({ item, index }))
      .filter(({ index }) => !hiddenIndices.has(index));
  }, [detectedItems, hiddenIndices]);

  const canRemoveItem = visibleItems.length > 1;

  const handleRemoveItem = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    if (!canRemoveItem) return;
    
    setHiddenIndices(prev => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
    
    if (selectedIndex === index) {
      const remaining = visibleItems.filter(v => v.index !== index);
      if (remaining.length > 0) {
        onSelectItem(remaining[0].index);
      }
    }
  }, [canRemoveItem, selectedIndex, visibleItems, onSelectItem]);

  const generateCroppedPreview = useCallback((index: number, box: BoundingBox) => {
    if (!imageRef.current) return;
    
    const img = imageRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    
    const cropX = (box.x / 100) * naturalWidth;
    const cropY = (box.y / 100) * naturalHeight;
    const cropWidth = (box.width / 100) * naturalWidth;
    const cropHeight = (box.height / 100) * naturalHeight;

    canvas.width = Math.max(1, Math.round(cropWidth));
    canvas.height = Math.max(1, Math.round(cropHeight));

    ctx.drawImage(
      img,
      cropX, cropY, cropWidth, cropHeight,
      0, 0, canvas.width, canvas.height
    );

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setAdjustedCroppedImages(prev => ({ ...prev, [index]: dataUrl }));
  }, []);

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

  const getBoxForItem = (index: number): BoundingBox | null => {
    if (adjustedBoundaries[index]) {
      return adjustedBoundaries[index];
    }
    return detectedItems[index]?.boundingBox || null;
  };

  const handleResizeStart = (
    e: React.MouseEvent | React.TouchEvent,
    index: number,
    handle: ResizeHandle
  ) => {
    e.stopPropagation();
    e.preventDefault();
    
    const box = getBoxForItem(index);
    if (!box) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setIsResizing(true);
    setResizeInfo({
      index,
      handle,
      startX: clientX,
      startY: clientY,
      startBox: { ...box },
    });
    onSelectItem(index);
  };

  const handleResizeMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!resizeInfo || !imageRef.current) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const imgRect = imageRef.current.getBoundingClientRect();
    const deltaXPercent = ((clientX - resizeInfo.startX) / imgRect.width) * 100;
    const deltaYPercent = ((clientY - resizeInfo.startY) / imgRect.height) * 100;

    const { handle, startBox, index } = resizeInfo;
    let newBox = { ...startBox };

    const minSize = 5;

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

    setAdjustedBoundaries(prev => ({
      ...prev,
      [index]: newBox,
    }));
  }, [resizeInfo]);

  const handleResizeEnd = useCallback(() => {
    if (resizeInfo) {
      const box = adjustedBoundaries[resizeInfo.index];
      if (box) {
        generateCroppedPreview(resizeInfo.index, box);
      }
    }
    setIsResizing(false);
    setResizeInfo(null);
  }, [resizeInfo, adjustedBoundaries, generateCroppedPreview]);

  const handleDragStart = (
    e: React.MouseEvent | React.TouchEvent,
    index: number
  ) => {
    e.stopPropagation();
    e.preventDefault();
    
    const box = getBoxForItem(index);
    if (!box) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setIsDragging(true);
    setDragInfo({
      index,
      startX: clientX,
      startY: clientY,
      startBox: { ...box },
    });
    onSelectItem(index);
  };

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragInfo || !imageRef.current) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const imgRect = imageRef.current.getBoundingClientRect();
    const deltaXPercent = ((clientX - dragInfo.startX) / imgRect.width) * 100;
    const deltaYPercent = ((clientY - dragInfo.startY) / imgRect.height) * 100;

    const { startBox, index } = dragInfo;
    
    let newX = startBox.x + deltaXPercent;
    let newY = startBox.y + deltaYPercent;
    
    newX = Math.max(0, Math.min(newX, 100 - startBox.width));
    newY = Math.max(0, Math.min(newY, 100 - startBox.height));

    setAdjustedBoundaries(prev => ({
      ...prev,
      [index]: {
        ...startBox,
        x: newX,
        y: newY,
      },
    }));
  }, [dragInfo]);

  const handleDragEnd = useCallback(() => {
    if (dragInfo) {
      const box = adjustedBoundaries[dragInfo.index];
      if (box) {
        generateCroppedPreview(dragInfo.index, box);
      }
    }
    setIsDragging(false);
    setDragInfo(null);
  }, [dragInfo, adjustedBoundaries, generateCroppedPreview]);

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

  const getBoxStyle = (box: BoundingBox, index: number) => {
    const goldColor = '#D4AF37';
    const isSelected = selectedIndex === index;
    const isHovered = hoveredIndex === index;
    const isBeingResized = resizeInfo?.index === index;

    return {
      left: `${box.x}%`,
      top: `${box.y}%`,
      width: `${box.width}%`,
      height: `${box.height}%`,
      borderColor: goldColor,
      borderWidth: isSelected || isHovered || isBeingResized ? '2px' : '1.5px',
      borderStyle: 'solid' as const,
      backgroundColor: isSelected ? 'rgba(212,175,55,0.08)' : isHovered ? 'rgba(212,175,55,0.04)' : 'transparent',
      boxShadow: isSelected || isBeingResized 
        ? '0 0 20px rgba(212,175,55,0.25), inset 0 0 0 1px rgba(212,175,55,0.3)' 
        : isHovered 
          ? '0 0 12px rgba(212,175,55,0.15)' 
          : 'none',
      borderRadius: '8px',
    };
  };

  const handleBoxClick = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isResizing && !isDragging) {
      onSelectItem(index);
    }
  };

  const handleBoxMouseDown = (e: React.MouseEvent | React.TouchEvent, index: number) => {
    const isSelected = selectedIndex === index;
    if (isSelected) {
      handleDragStart(e, index);
    }
  };

  const handleShowProducts = () => {
    if (selectedIndex !== null) {
      const item = detectedItems[selectedIndex];
      const adjustedBox = adjustedBoundaries[selectedIndex];
      onSearchItem(item, adjustedBox);
    }
  };

  const handleShowAllProducts = () => {
    const allItems = visibleItems.map(({ item, index }) => ({
      item,
      adjustedBox: adjustedBoundaries[index],
    }));
    onSearchAllItems(allItems);
  };

  const selectedItem = selectedIndex !== null ? detectedItems[selectedIndex] : null;
  const selectedBox = selectedIndex !== null ? getBoxForItem(selectedIndex) : null;
  const hasAdjustment = selectedIndex !== null && adjustedBoundaries[selectedIndex] !== undefined;

  const renderResizeHandles = (index: number, box: BoundingBox) => {
    const goldColor = '#D4AF37';
    const isSelected = selectedIndex === index;
    
    if (!isSelected) return null;

    const handles: { position: ResizeHandle; style: React.CSSProperties }[] = [
      { position: 'nw', style: { top: '-5px', left: '-5px', cursor: 'nwse-resize' } },
      { position: 'n', style: { top: '-5px', left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' } },
      { position: 'ne', style: { top: '-5px', right: '-5px', cursor: 'nesw-resize' } },
      { position: 'e', style: { top: '50%', right: '-5px', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
      { position: 'se', style: { bottom: '-5px', right: '-5px', cursor: 'nwse-resize' } },
      { position: 's', style: { bottom: '-5px', left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' } },
      { position: 'sw', style: { bottom: '-5px', left: '-5px', cursor: 'nesw-resize' } },
      { position: 'w', style: { top: '50%', left: '-5px', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
    ];

    return handles.map(({ position, style }) => (
      <div
        key={position}
        className="absolute w-2.5 h-2.5 rounded-full z-10"
        style={{
          ...style,
          backgroundColor: goldColor,
          border: '1.5px solid white',
          boxShadow: '0 2px 6px rgba(0,0,0,0.2), 0 0 0 1px rgba(212,175,55,0.3)',
        }}
        onMouseDown={(e) => handleResizeStart(e, index, position)}
        onTouchStart={(e) => handleResizeStart(e, index, position)}
      />
    ));
  };

  const activeIndex = selectedIndex !== null ? selectedIndex : hoveredIndex;
  const activeItem = activeIndex !== null && !hiddenIndices.has(activeIndex) ? detectedItems[activeIndex] : null;
  const showDescription = !isSearching && activeItem?.description;

  return (
    <div className="flex flex-col md:flex-row items-center md:items-start justify-center gap-4 w-full">
      <div 
        ref={containerRef}
        className="relative w-full max-w-sm rounded-3xl overflow-hidden flex-shrink-0"
        style={{
          background: 'linear-gradient(145deg, rgba(255,255,255,0.95), rgba(250,248,245,0.98))',
          border: `1px solid rgba(212,175,55,0.15)`,
          boxShadow: `0 20px 60px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.8)`,
        }}
      >
        <div 
          className="relative p-3" 
          style={{ 
            userSelect: (isResizing || isDragging) ? 'none' : 'auto',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.6) 0%, transparent 100%)',
          }}
        >
          <div className="rounded-2xl overflow-hidden" style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
            <img
              ref={imageRef}
              src={imageUrl}
              alt="Uploaded jewelry"
              className="w-full h-auto max-h-[45vh] object-contain"
              onLoad={updateDimensions}
              style={{ 
                display: 'block', 
                pointerEvents: (isResizing || isDragging) ? 'none' : 'auto',
                background: 'white',
              }}
            />
          </div>
          
          {isSearching && (
            <motion.div 
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ background: 'rgba(0,0,0,0.3)' }}
            >
              <motion.div
                className="flex items-center gap-2 px-4 py-2 rounded-full"
                style={{ 
                  background: theme.glassBg,
                  backdropFilter: 'blur(8px)',
                }}
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                  <Sparkles className="h-5 w-5" style={{ color: theme.accent }} />
                </motion.div>
                <span className="text-sm font-medium" style={{ color: theme.text }}>
                  Finding similar...
                </span>
              </motion.div>
            </motion.div>
          )}

          {!isSearching && detectedItems.map((item, index) => {
            if (hiddenIndices.has(index)) return null;
            const box = getBoxForItem(index);
            if (!box) return null;
            const isSelected = selectedIndex === index;

            return (
              <div key={`box-${index}`}>
                <div
                  className="absolute transition-all duration-300"
                  style={{
                    ...getBoxStyle(box, index),
                    cursor: (isResizing || isDragging) ? 'default' : (selectedIndex === index ? 'move' : 'pointer'),
                  }}
                  onClick={(e) => handleBoxClick(index, e)}
                  onMouseDown={(e) => handleBoxMouseDown(e, index)}
                  onTouchStart={(e) => handleBoxMouseDown(e, index)}
                  onMouseEnter={() => !(isResizing || isDragging) && setHoveredIndex(index)}
                  onMouseLeave={() => !(isResizing || isDragging) && setHoveredIndex(null)}
                >
                  <motion.span
                    className="absolute -top-7 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap capitalize tracking-wide"
                    style={{
                      background: 'linear-gradient(135deg, #B8860B, #D4AF37)',
                      color: 'white',
                      boxShadow: '0 4px 12px rgba(212,175,55,0.35), 0 2px 4px rgba(0,0,0,0.1)',
                      border: '1px solid rgba(255,255,255,0.3)',
                      letterSpacing: '0.5px',
                    }}
                    initial={{ y: 5, opacity: 0, scale: 0.9 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.1 + 0.2, type: 'spring', stiffness: 300 }}
                  >
                    {item.type}
                  </motion.span>
                  
                  {isSelected && canRemoveItem && (
                    <motion.button
                      className="absolute -top-7 -right-2 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{
                        background: 'linear-gradient(135deg, #DC2626, #EF4444)',
                        boxShadow: '0 2px 8px rgba(220,38,38,0.4)',
                        border: '1.5px solid white',
                      }}
                      onClick={(e) => handleRemoveItem(index, e)}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      title="Remove this item"
                    >
                      <X className="w-3 h-3 text-white" />
                    </motion.button>
                  )}
                  
                  {renderResizeHandles(index, box)}
                </div>
              </div>
            );
          })}
          
        </div>

        <div 
          className="flex items-center justify-center gap-3 px-4 py-4"
          style={{ 
            borderTop: `1px solid rgba(212,175,55,0.1)`,
            background: 'linear-gradient(180deg, transparent 0%, rgba(250,248,245,0.5) 100%)',
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSearch}
            className="transition-all duration-300 hover:bg-gray-100/50 rounded-full px-4"
            style={{ 
              color: '#6B7280',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            <X className="h-4 w-4 mr-2" />
            Clear
          </Button>
          <Button
            size="sm"
            onClick={handleShowAllProducts}
            disabled={isSearching}
            className="transition-all duration-300 hover:scale-[1.02] hover:shadow-lg rounded-full px-5"
            style={{
              background: 'linear-gradient(135deg, #B8860B 0%, #D4AF37 50%, #C9A227 100%)',
              color: 'white',
              boxShadow: '0 4px 15px rgba(212,175,55,0.3), 0 2px 4px rgba(0,0,0,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              fontSize: '13px',
              fontWeight: 500,
              letterSpacing: '0.3px',
            }}
          >
            <Search className="h-4 w-4 mr-2" />
            {isSearching ? 'Finding...' : `Find Similar (${visibleItems.length})`}
          </Button>
        </div>
      </div>

      {/* Description panel - hidden on mobile, shown on tablet/desktop */}
      <AnimatePresence mode="wait">
        {showDescription ? (
          <motion.div
            key={`desc-${activeIndex}`}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="hidden md:block w-full max-w-xs"
          >
            <div 
              className="px-4 py-4 rounded-2xl h-full"
              style={{
                background: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid rgba(212,175,55,0.15)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.06), 0 2px 8px rgba(212,175,55,0.05)',
              }}
            >
              <div className="flex flex-col gap-3">
                {(adjustedCroppedImages[activeIndex!] || activeItem?.croppedDataUrl) && (
                  <img
                    src={adjustedCroppedImages[activeIndex!] || activeItem?.croppedDataUrl!}
                    alt={activeItem?.type}
                    className="w-20 h-20 rounded-xl object-contain mx-auto"
                    style={{ 
                      background: 'white',
                      border: '1.5px solid rgba(212,175,55,0.25)',
                    }}
                  />
                )}
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-semibold capitalize"
                      style={{
                        background: 'linear-gradient(135deg, #B8860B, #D4AF37)',
                        color: 'white',
                      }}
                    >
                      {activeItem?.type}
                    </span>
                    {activeIndex !== null && adjustedBoundaries[activeIndex] !== undefined && (
                      <span 
                        className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ 
                          background: 'rgba(212,175,55,0.12)',
                          color: '#B8860B',
                        }}
                      >
                        Adjusted
                      </span>
                    )}
                  </div>
                  <p 
                    className="text-sm leading-relaxed"
                    style={{ color: '#4A4A4A' }}
                  >
                    {activeItem?.description}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="placeholder"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="hidden md:flex w-full max-w-xs items-center justify-center"
          >
            <div 
              className="px-4 py-6 rounded-2xl w-full text-center"
              style={{
                background: 'rgba(255, 255, 255, 0.6)',
                border: '1px dashed rgba(212,175,55,0.25)',
              }}
            >
              <p className="text-sm" style={{ color: theme.textMuted }}>
                Hover or tap an item to see details
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile description - shown below on mobile only */}
      <AnimatePresence>
        {showDescription && (
          <motion.div
            key={`desc-mobile-${activeIndex}`}
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="md:hidden w-full max-w-sm mx-auto mt-3"
          >
            <div 
              className="px-4 py-3 rounded-2xl"
              style={{
                background: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid rgba(212,175,55,0.15)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.06), 0 2px 8px rgba(212,175,55,0.05)',
              }}
            >
              <div className="flex items-start gap-3">
                {(adjustedCroppedImages[activeIndex!] || activeItem?.croppedDataUrl) && (
                  <img
                    src={adjustedCroppedImages[activeIndex!] || activeItem?.croppedDataUrl!}
                    alt={activeItem?.type}
                    className="w-14 h-14 rounded-xl object-contain flex-shrink-0"
                    style={{ 
                      background: 'white',
                      border: '1.5px solid rgba(212,175,55,0.25)',
                    }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize"
                      style={{
                        background: 'linear-gradient(135deg, #B8860B, #D4AF37)',
                        color: 'white',
                      }}
                    >
                      {activeItem?.type}
                    </span>
                    {activeIndex !== null && adjustedBoundaries[activeIndex] !== undefined && (
                      <span 
                        className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ 
                          background: 'rgba(212,175,55,0.12)',
                          color: '#B8860B',
                        }}
                      >
                        Adjusted
                      </span>
                    )}
                  </div>
                  <p 
                    className="text-sm leading-relaxed"
                    style={{ color: '#4A4A4A' }}
                  >
                    {activeItem?.description}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile hint - shown only when no item is hovered/selected */}
      {detectedItems.length > 0 && !selectedIndex && hoveredIndex === null && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="md:hidden mt-3 text-xs text-center px-4"
          style={{ color: theme.textMuted }}
        >
          Hover or tap items to see details. Click to select and adjust boundaries.
        </motion.p>
      )}
    </div>
  );
}
