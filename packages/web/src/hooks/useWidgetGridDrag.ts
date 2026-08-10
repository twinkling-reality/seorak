import { useCallback, useState } from 'react';
import { KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

import { GRID_DROPPABLE_ID, type CatalogDragPayload } from '../components/WidgetGrid/WidgetGrid.js';

export function useWidgetGridDrag({
  slotIds,
  onCatalogInsert,
  onReorder,
}: {
  slotIds: string[];
  onCatalogInsert: (widgetId: string, insertIndex: number) => void;
  onReorder: (nextIds: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const [catalogDragging, setCatalogDragging] = useState<CatalogDragPayload | null>(null);
  const [sortableDragging, setSortableDragging] = useState<{
    id: string;
    w: number;
    h: number;
  } | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const activeId = String(event.active.id);
    if (activeId.startsWith('catalog:')) {
      const data = event.active.data.current as CatalogDragPayload | undefined;
      if (data) setCatalogDragging(data);
      return;
    }
    const rect = event.active.rect.current.initial;
    if (rect) {
      setSortableDragging({ id: activeId, w: rect.width, h: rect.height });
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setCatalogDragging(null);
      setSortableDragging(null);
      const { active, over } = event;
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);

      if (activeId.startsWith('catalog:')) {
        const data = active.data.current as CatalogDragPayload | undefined;
        if (!data) return;
        const insertIndex =
          overId === GRID_DROPPABLE_ID ? slotIds.length : slotIds.indexOf(overId);
        if (insertIndex < 0) return;
        onCatalogInsert(data.widgetId, insertIndex);
        return;
      }

      if (activeId === overId) return;
      const oldIndex = slotIds.indexOf(activeId);
      const newIndex = slotIds.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return;
      onReorder(arrayMove(slotIds, oldIndex, newIndex));
    },
    [onCatalogInsert, onReorder, slotIds],
  );

  const handleDragCancel = useCallback(() => {
    setCatalogDragging(null);
    setSortableDragging(null);
  }, []);

  return {
    sensors,
    catalogDragging,
    sortableDragging,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
}
