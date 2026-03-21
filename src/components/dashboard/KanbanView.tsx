import { useState, useMemo, useCallback, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { type DashboardViewProps, type RowData } from './types';
import type { SmartSchema } from '../../lib/db';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface KanbanViewProps extends DashboardViewProps {
    onUpdateNote: (id: number, field: string, value: string) => void;
    onReorderNotes: (updates: { id: number; order: number }[]) => void;
}

// ─── Kanban: Sortable Card ──────────────────────────────────────────────────
const KanbanCard = memo(function KanbanCard({
    row,
    schema,
    selectField,
    onSelectNote,
    isDragOverlay = false,
}: {
    row: RowData;
    schema: SmartSchema;
    selectField: { name: string; type: string };
    onSelectNote: (id: number) => void;
    isDragOverlay?: boolean;
}) {
    const id = String(row.item.id);
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
        padding: '20px',
        backgroundColor: 'var(--color-card-bg)',
        boxShadow: isDragOverlay
            ? '0 16px 40px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.7)'
            : '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.6)',
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={[
                'w-full group/card text-left rounded-xl border overflow-hidden cursor-grab active:cursor-grabbing focus:outline-none',
                isDragOverlay
                    ? 'border-black/20 dark:border-white/20 rotate-[1.5deg] scale-[1.02]'
                    : 'border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 hover:-translate-y-0.5 hover:shadow-xl dark:hover:shadow-black/40',
                isDragging ? '' : 'transition-all duration-200',
                'dark:bg-dark-ui',
            ].join(' ')}
            onClick={() => {
                // Prevent drag click from triggering note selection if we actually dragged, 
                // but since dnd-kit pointer sensors handle distance, a simple click passes through.
                if (isDragging) return;
                onSelectNote(row.item.id!);
            }}
        >
            <div className="flex flex-col gap-0 min-w-0">
                {/* Icon + Title */}
                <div className="flex items-start gap-2.5 mb-3">
                    {row.item.icon && (
                        <span style={{ fontSize: '1.25rem', lineHeight: 1, flexShrink: 0 }}>{row.item.icon}</span>
                    )}
                    <span
                        className="text-[13px] font-semibold text-dark-bg dark:text-light-bg leading-snug"
                        style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                    >
                        {row.item.title || 'Untitled'}
                    </span>
                </div>

                {/* Meta Fields (exclude the grouping field) */}
                {schema.fields.length > 1 && (
                    <>
                        {schema.fields.some(f => f.name !== selectField.name && !!row.meta[f.name]) && (
                            <div style={{ borderTop: '1px solid rgba(128,128,128,0.12)', margin: '10px 0' }} />
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {schema.fields.map(f => {
                                if (f.name === selectField.name) return null;
                                const val = row.meta[f.name] || '';
                                if (!val) return null;
                                return (
                                    <div key={f.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '2px 0' }}>
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-dark-bg/35 dark:text-light-bg/30 shrink-0">
                                            {f.name}
                                        </span>
                                        <span className="text-[10px] font-medium text-dark-bg/65 dark:text-light-bg/60 truncate text-right">
                                            {f.type === 'checkbox' ? (val === 'true' ? '✓' : '✗') : val}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
});

// ─── Kanban: Droppable Column ───────────────────────────────────────────────
const KanbanColumn = memo(function KanbanColumn({
    colName,
    colNotes,
    isOver,
    schema,
    selectField,
    onSelectNote,
}: {
    colName: string;
    colNotes: RowData[];
    isOver: boolean;
    schema: SmartSchema;
    selectField: { name: string; type: string };
    onSelectNote: (id: number) => void;
}) {
    const { setNodeRef } = useDroppable({
        id: colName,
    });

    const itemIds = useMemo(() => colNotes.map(r => String(r.item.id)), [colNotes]);

    return (
        <div
            ref={setNodeRef}
            className={[
                'flex flex-col flex-shrink-0 w-[320px] rounded-xl border overflow-hidden transition-colors duration-150',
                isOver
                    ? 'bg-black/[0.055] dark:bg-white/[0.07] border-black/12 dark:border-white/12'
                    : 'bg-black/[0.03] dark:bg-white/[0.03] border-black/5 dark:border-white/5',
            ].join(' ')}
        >
            {/* Column Header */}
            <div
                className="flex items-center justify-between border-b border-black/5 dark:border-white/5 bg-transparent"
                style={{ padding: '16px 20px' }}
            >
                <span className="text-[11px] font-bold uppercase tracking-widest text-dark-bg/60 dark:text-light-bg/60">
                    {colName}
                </span>
                <span
                    className="text-[10px] font-medium rounded-full bg-black/5 dark:bg-white/10 text-dark-bg/40 dark:text-light-bg/40"
                    style={{ padding: '2px 8px' }}
                >
                    {colNotes.length}
                </span>
            </div>

            {/* Column Body */}
            <SortableContext
                items={itemIds}
                strategy={verticalListSortingStrategy}
            >
                <div
                    className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-light-border dark:scrollbar-thumb-dark-border"
                    style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', minHeight: '80px' }}
                >
                    {colNotes.map(row => (
                        <KanbanCard
                            key={row.item.id}
                            row={row}
                            schema={schema}
                            selectField={selectField}
                            onSelectNote={onSelectNote}
                        />
                    ))}
                    {colNotes.length === 0 && !isOver && (
                        <div className="h-full flex items-center justify-center min-h-[80px] border-2 border-dashed border-black/5 dark:border-white/5 rounded-xl">
                            <span className="text-xs text-dark-bg/25 dark:text-light-bg/25 font-medium">Drop cards here</span>
                        </div>
                    )}
                    {colNotes.length === 0 && isOver && (
                        <div className="min-h-[80px] rounded-xl border-2 border-dashed border-black/15 dark:border-white/15" />
                    )}
                </div>
            </SortableContext>
        </div>
    );
});

// ─── Kanban View ─────────────────────────────────────────────────────────────
export function KanbanView({
    notes,
    schema,
    onSelectNote,
    onUpdateNote,
    onReorderNotes
}: KanbanViewProps) {
    if (!schema) return null;
    const selectField = schema.fields.find(f => f.type === 'select');

    // Make options and columnOrder robust against missing selectField
    const options = selectField?.options || [];
    const columnOrder = ['Uncategorized', ...options];

    // options is now just a plain array, no useMemo needed unless we want to avoid recreating it
    // Wait, the hook array needs options as dependency. Options array changes if selectField?.options changes reference.
    const optionsStr = JSON.stringify(options); // stringify for dependency safety

    // columns state: Record<colName, RowData[]>
    const buildColumns = useCallback((rows: RowData[]) => {
        const cols: Record<string, RowData[]> = { 'Uncategorized': [] };
        const parsedOptions = JSON.parse(optionsStr);
        parsedOptions.forEach((opt: string) => { cols[opt] = []; });
        
        if (!selectField) return cols;

        rows.forEach(row => {
            const val = row.meta[selectField.name];
            if (val && cols[val] !== undefined) cols[val].push(row);
            else cols['Uncategorized'].push(row);
        });
        return cols;
    }, [optionsStr, selectField]);

    const baseColumns = useMemo(() => buildColumns(notes), [notes, buildColumns]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [overColNameState, setOverColNameState] = useState<string | null>(null);
    
    // Use a ref to track the latest over column without triggering renders instantly
    const overColRef = useRef<string | null>(null);
    
    // Synchronize ref and state safely without loops
    const setOverColName = useCallback((newVal: string | null) => {
        if (overColRef.current !== newVal) {
            overColRef.current = newVal;
            setOverColNameState(newVal);
        }
    }, []);

    // Build a card-id → column lookup from baseColumns
    const cardToBaseCol = useMemo(() => {
        const map: Record<string, string> = {};
        Object.entries(baseColumns).forEach(([col, rows]) => {
            rows.forEach(r => { map[String(r.item.id)] = col; });
        });
        return map;
    }, [baseColumns]);

    // Compute active columns without mutating arrays during layout
    const columns = useMemo(() => {
        return baseColumns;
    }, [baseColumns]);

    const activeRow = useMemo(() => {
        if (!activeId) return null;
        const col = cardToBaseCol[activeId];
        if (!col) return null;
        return baseColumns[col]?.find(r => String(r.item.id) === activeId) ?? null;
    }, [activeId, cardToBaseCol, baseColumns]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragStart = ({ active }: DragStartEvent) => {
        setActiveId(String(active.id));
    };

    const handleDragOver = ({ active, over }: DragOverEvent) => {
        if (!over) { setOverColName(null); return; }
        const activeCol = cardToBaseCol[String(active.id)];
        // over.id can be a card id or a column id (droppable)
        const overCol = cardToBaseCol[String(over.id)] ?? (columnOrder.includes(String(over.id)) ? String(over.id) : null);
        if (!activeCol || !overCol || activeCol === overCol) { setOverColName(overCol); return; }

        setOverColName(overCol);
    };

    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        setActiveId(null);
        setOverColName(null);
        if (!over || !selectField) return;

        const activeCol = cardToBaseCol[String(active.id)];
        const overCol = cardToBaseCol[String(over.id)] ?? (columnOrder.includes(String(over.id)) ? String(over.id) : null);
        if (!activeCol || !overCol) return;

        // Reorder within same column
        if (activeCol === overCol) {
            const colNotes = baseColumns[activeCol] || [];
            const oldIdx = colNotes.findIndex(r => String(r.item.id) === String(active.id));
            const newIdx = colNotes.findIndex(r => String(r.item.id) === String(over.id));
            
            if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
                const item = colNotes[oldIdx];
                const newOrderArr = arrayMove(colNotes, oldIdx, newIdx);
                
                // Calculate safe global order (midpoint between neighbors)
                const prevItem = newOrderArr[newIdx - 1];
                const nextItem = newOrderArr[newIdx + 1];
                
                let newOrderValue = 0;
                if (!prevItem && nextItem) {
                    newOrderValue = (nextItem.item.order ?? 0) - 1000;
                } else if (prevItem && !nextItem) {
                    newOrderValue = (prevItem.item.order ?? 0) + 1000;
                } else if (prevItem && nextItem) {
                    newOrderValue = ((prevItem.item.order ?? 0) + (nextItem.item.order ?? 0)) / 2;
                }
                
                onReorderNotes([{ id: item.item.id!, order: newOrderValue }]);
            }
            return;
        }

        // Commit new column to DB
        const noteId = parseInt(String(active.id), 10);
        const newValue = overCol === 'Uncategorized' ? '' : overCol;
        onUpdateNote(noteId, selectField.name, newValue);
    };

    if (!selectField) {
        return (
            <div style={{ padding: '40px 20px', textAlign: 'center', opacity: 0.35, fontSize: '0.85rem' }}>
                No 'select' field found for Kanban view.
            </div>
        );
    }

    return (
        <div className="flex h-full w-full overflow-x-auto overflow-y-hidden" style={{ padding: '16px' }}>
            <DndContext
                sensors={sensors}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
            >
                <div style={{ display: 'flex', gap: '16px', height: '100%', alignItems: 'flex-start' }}>
                    {columnOrder.map(colName => {
                        let filteredNotes = columns[colName] || [];
                        
                        // We do local optimistic rendering of the dragged card across columns without mutating React state arrays
                        const isActiveCol = activeRow && cardToBaseCol[String(activeRow.item.id)] === colName;
                        const isTargetCol = activeRow && overColNameState === colName;
                        
                        if (isActiveCol && activeRow && !isTargetCol) {
                            filteredNotes = filteredNotes.filter(r => String(r.item.id) !== activeId);
                        } else if (isTargetCol && activeRow && !isActiveCol) {
                            filteredNotes = [...filteredNotes, activeRow];
                        }
                        
                        return (
                            <KanbanColumn
                                key={colName}
                                colName={colName}
                                colNotes={filteredNotes}
                                isOver={overColNameState === colName}
                                schema={schema}
                                selectField={selectField}
                                onSelectNote={onSelectNote}
                            />
                        );
                    })}
                </div>

                {createPortal(
                    <DragOverlay dropAnimation={null}>
                        {activeId && activeRow ? (
                            <div className="w-[280px]">
                                <KanbanCard
                                    row={activeRow}
                                    schema={schema}
                                    selectField={selectField}
                                    onSelectNote={onSelectNote}
                                    isDragOverlay
                                />
                            </div>
                        ) : null}
                    </DragOverlay>,
                    document.body
                )}
            </DndContext>
        </div>
    );
}
