import { type ReactNode } from "react";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Pages to put in order: drag a tile, or use its arrows. A plain click still reaches the tile. */
export function SortableTiles<T extends { id: string }>({ items, onChange, render, className, testId }: {
  items: T[];
  onChange: (next: T[]) => void;
  render: (item: T, index: number) => ReactNode;
  className?: string;
  testId?: string;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const move = (from: number, to: number) => { if (to >= 0 && to < items.length) onChange(arrayMove(items, from, to)); };
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    move(items.findIndex(i => i.id === active.id), items.findIndex(i => i.id === over.id));
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map(i => i.id)} strategy={rectSortingStrategy}>
        <div className={className} data-testid={testId}>
          {items.map((item, i) => (
            <Tile key={item.id} id={item.id} index={i} count={items.length} onMove={by => move(i, i + by)}>{render(item, i)}</Tile>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function Tile({ id, index, count, onMove, children }: { id: string; index: number; count: number; onMove: (by: number) => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const arrow = "grid h-6 w-6 place-items-center rounded-full border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-30";
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? "relative z-10 opacity-80" : undefined} data-testid={`tile-${index + 1}`}>
      <div ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Page ${index + 1}: drag to move`} className="cursor-grab touch-manipulation active:cursor-grabbing">{children}</div>
      <div className="mt-1 flex justify-center gap-1">
        <button type="button" className={arrow} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move page ${index + 1} earlier`} data-testid={`tile-earlier-${index + 1}`}><ChevronLeft className="h-3.5 w-3.5" /></button>
        <button type="button" className={arrow} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move page ${index + 1} later`} data-testid={`tile-later-${index + 1}`}><ChevronRight className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}
