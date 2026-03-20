import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { db, getFullPath, type NoteItem } from '../lib/db';
import { readSchema, parseYamlFrontmatter, serializeYamlFrontmatter } from '../lib/smartProps';
import type { SmartSchema } from '../lib/db';
import { updateSearchIndex, miniSearch } from '../lib/search';
import { triggerAutoSync } from '../lib/sync';
import { getStorageMode, writeNoteToVault, notePathFromTitle } from '../lib/vault';
import { FileText, ArrowDown, ArrowUp, ArrowUpDown, Tag } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { snapCenterToCursor } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import type { SortingState } from '@tanstack/react-table';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';

export type ViewMode = 'table' | 'gallery' | 'calendar' | 'kanban';

interface DashboardProps {
    folderName?: string;
    tagName?: string | null;
    onSelectNote: (id: number) => void;
    viewMode: ViewMode;
    onHasDateField: (has: boolean) => void;
    onHasSelectField: (has: boolean) => void;
}

type RowData = {
    item: NoteItem;
    meta: Record<string, string>;
    rawContent: string;
};

const columnHelper = createColumnHelper<RowData>();

function colMinWidth(type: string): number {
    switch (type) {
        case 'date':     return 150;
        case 'number':   return 100;
        case 'checkbox': return 72;
        case 'select':   return 140;
        case 'relation': return 180;
        default:         return 190;
    }
}

const baseInput: React.CSSProperties = {
    width: '100%', background: 'transparent', outline: 'none',
    border: 'none', padding: 0, margin: 0,
    fontSize: 'inherit', color: 'inherit', fontFamily: 'inherit', minWidth: 0,
};

/**
 * CellInput — key-remount strategy for live sync + stable cursor.
 *
 * The `key` prop is driven by `value` (the external DB-backed value).
 * - While user types: `notes` state is unchanged → same key → no remount → cursor stable
 * - When external update arrives (Dashboard event or PropertiesHeader sync):
 *     `notes` state changes → new key → input remounts with fresh `defaultValue` ✅
 *
 * This is the simplest approach that is immune to React StrictMode, TanStack
 * re-renders, and async useEffect timing issues — because there are no refs
 * or effects at all.
 */
const CellInput = ({
    value,
    type,
    onSave,
    placeholder,
    className,
    style,
    title,
}: {
    value: string;
    type: string;
    onSave: (val: string) => void;
    placeholder?: string;
    className?: string;
    style?: React.CSSProperties;
    title?: string;
}) => {
    // URL display mode (clickable link)
    const [editingUrl, setEditingUrl] = useState(false);
    const isUrl = type === 'text' && value.match(/^https?:\/\/[^\s]+$/i);

    if (isUrl && !editingUrl) {
        return (
            <div className="flex items-center justify-between group/link w-full" style={style}>
                <a href={value} target="_blank" rel="noreferrer"
                    className="text-indigo-500 hover:underline truncate px-1" title={value}>
                    {value}
                </a>
                <button onClick={(e) => { e.stopPropagation(); setEditingUrl(true); }}
                    className="opacity-0 group-hover/link:opacity-100 text-dark-bg/40 hover:text-dark-bg/80 dark:text-light-bg/40 dark:hover:text-light-bg/80 px-1 shrink-0 transition-opacity"
                    title="Edit link">✎
                </button>
            </div>
        );
    }

    return (
        <input
            key={value}          // ← remounts when external DB value changes (live sync)
            type={type}
            defaultValue={value} // ← uncontrolled: user typing never causes re-renders
            placeholder={placeholder}
            onBlur={(e) => {
                const newVal = e.target.value;
                if (newVal !== value) {
                    setTimeout(() => onSave(newVal), 20); // slightly longer delay for Firefox stability
                }
                if (editingUrl) setEditingUrl(false);
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
            onChange={(e) => {
                // Firefox spinner clicks don't focus the input natively! Force it here
                // so that clicking away later successfully triggers the blur event.
                if (document.activeElement !== e.target) {
                    e.target.focus();
                }
            }}
            autoFocus={editingUrl}
            style={style}
            className={className}
            title={title}
        />
    );
};

const HP = '11px 18px'; // header padding
const CP = '10px 18px'; // cell padding
const BD = '1px solid rgba(128,128,128,0.12)';

// ─── Calendar View ─────────────────────────────────────────────────────────────
function CalendarView({
    notes,
    schema,
    onSelectNote,
}: {
    notes: RowData[];
    schema: SmartSchema;
    onSelectNote: (id: number) => void;
}) {
    // Find first date field in schema
    const dateField = schema.fields.find(f => f.type === 'date');

    if (!dateField) {
        return (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📅</div>
                <div className="text-sm text-dark-bg/50 dark:text-light-bg/50 font-medium">
                    Add a <strong>Date</strong> field to this Smart Folder to use Calendar view.
                </div>
            </div>
        );
    }

    const events = Object.values(notes).map(row => {
        const val = row.meta[dateField.name];
        if (!val) return null;
        return {
            id: String(row.item.id),
            title: row.item.title || 'Untitled',
            date: val,
            allDay: true,
            extendedProps: {
                icon: row.item.icon,
                noteId: row.item.id,
            }
        };
    }).filter(Boolean);

    return (
        <div className="p-4 rounded-xl calendar-container" style={{ minHeight: '600px' }}>
            <style>{`
                .calendar-container {
                    --fc-border-color: rgba(0, 0, 0, 0.06); 
                    font-family: inherit;
                    display: flex;
                    flex-direction: column;
                }
                .dark .calendar-container {
                    --fc-border-color: rgba(255, 255, 255, 0.08); 
                }
                
                /* Responsive Toolbar - Premium Desktop Layout */
                .fc .fc-toolbar.fc-header-toolbar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 24px;
                    padding: 0 16px; /* Added left and right padding */
                    min-height: 40px;
                }
                
                /* Toolbar Chunks */
                .fc .fc-toolbar-chunk {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }
                
                /* Title */
                .fc .fc-toolbar-title {
                    font-size: 1.25rem;
                    font-weight: 700;
                    color: inherit;
                    line-height: 1;
                    margin: 0 !important;
                    padding: 0;
                    display: flex;
                    align-items: center;
                }
                
                /* Button Base Styles */
                .fc .fc-button-primary {
                    background-color: transparent !important;
                    border: 1px solid transparent !important;
                    color: inherit !important;
                    box-shadow: none !important;
                    font-weight: 500;
                    padding: 6px 12px;
                    text-transform: capitalize;
                    line-height: 1.4;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                    height: 32px; /* ensure uniform height */
                }
                
                .fc .fc-button-primary:hover {
                    background-color: rgba(128, 128, 128, 0.08) !important;
                    border-radius: 6px;
                }
                
                .fc .fc-button-primary:not(:disabled).fc-button-active, 
                .fc .fc-button-primary:not(:disabled):active {
                    background-color: rgba(128, 128, 128, 0.12) !important;
                    color: inherit !important;
                    box-shadow: none !important;
                    border-radius: 6px;
                }
                
                .fc .fc-button-primary:focus {
                    box-shadow: none !important;
                }
                
                /* Button Groups (Month/Week, Nav) */
                .fc .fc-button-group {
                    display: flex;
                    align-items: center;
                    height: 32px;
                }
                
                /* Left-side chunk usually holds Prev/Next/Today on mobile if reordered, but here it's on the right */
                .fc-toolbar-chunk:last-child > .fc-button-group:first-child {
                    background: rgba(128, 128, 128, 0.06);
                    border-radius: 8px;
                    padding: 2px;
                    height: 36px;
                    gap: 2px;
                }
                
                .fc-toolbar-chunk:last-child > .fc-button-group:first-child .fc-button {
                    height: 32px;
                    margin: 0;
                    border-radius: 6px;
                }
                
                /* Remove underlines from links */
                .fc a {
                    text-decoration: none !important;
                    color: inherit;
                }
                
                /* Header Cells (Mon, Tue, Wed...) */
                .fc-theme-standard th {
                    border: none;
                    border-bottom: 1px solid var(--fc-border-color);
                    padding: 12px 0 8px 0;
                }
                
                .fc-col-header-cell-cushion {
                    font-weight: 500;
                    font-size: 0.85rem;
                    color: rgba(128, 128, 128, 0.6);
                    text-transform: capitalize;
                }
                
                .dark .fc-col-header-cell-cushion {
                    color: rgba(255, 255, 255, 0.5);
                }
                
                /* Grid Cells */
                .fc-theme-standard td, .fc-theme-standard th {
                    border-color: var(--fc-border-color);
                }
                
                .fc-daygrid-day-top {
                    justify-content: flex-end;
                    padding: 8px 10px 0 0;
                }
                
                .fc-daygrid-day-number {
                    font-size: 0.85rem;
                    font-weight: 500;
                    color: rgba(128, 128, 128, 0.7);
                    line-height: 1;
                }
                
                .dark .fc-daygrid-day-number {
                    color: rgba(255, 255, 255, 0.6);
                }
                
                /* Today Highlighting */
                .fc .fc-daygrid-day.fc-day-today {
                    background-color: rgba(0, 0, 0, 0.015) !important;
                }
                
                .dark .fc .fc-daygrid-day.fc-day-today {
                    background-color: rgba(255, 255, 255, 0.015) !important;
                }
                
                .fc .fc-day-today .fc-daygrid-day-top {
                    opacity: 1;
                }
                
                .fc .fc-day-today .fc-daygrid-day-number {
                    background-color: #ef4444;
                    color: white !important;
                    border-radius: 50%;
                    width: 24px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    margin-right: -4px;
                    margin-top: -4px;
                }
                
                /* Event Cards */
                .fc-event {
                    cursor: pointer;
                    border: 1px solid rgba(0, 0, 0, 0.06) !important;
                    background: var(--color-card-bg, white) !important;
                    color: inherit !important;
                    padding: 4px 6px;
                    border-radius: 6px;
                    font-size: 0.75rem;
                    font-weight: 500;
                    margin: 2px 6px 2px 6px !important;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
                    transition: all 0.2s ease;
                    display: block;
                }
                
                .fc-event:hover {
                    background: rgba(128, 128, 128, 0.08) !important;
                    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.06);
                    transform: translateY(-1px);
                }
                
                .dark .fc-event {
                    border-color: rgba(255, 255, 255, 0.08) !important;
                }
                
                .dark .fc-event:hover {
                    background: rgba(255, 255, 255, 0.08) !important;
                }
                
                .fc-daygrid-event-dot {
                    display: none;
                }
                
                /* Mobile Layout - Single Row Precision */
                @media (max-width: 640px) {
                    .fc .fc-toolbar.fc-header-toolbar {
                        display: flex;
                        flex-direction: row;
                        align-items: center;
                        justify-content: space-between;
                        flex-wrap: nowrap;
                        gap: 8px;
                        margin-bottom: 16px;
                        padding: 0 12px; /* Add slightly smaller padding for mobile */
                        min-height: 40px;
                    }
                    
                    
                    /* Title chunk (Left) */
                    .fc .fc-toolbar-chunk:first-child {
                        flex: 1 1 auto;
                        justify-content: flex-start;
                        min-width: 0; /* allows truncation */
                        gap: 0;
                    }
                    .fc .fc-toolbar-title {
                        font-size: 1.1rem !important;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    
                    /* Center chunk (Month/Week toggle) */
                    .fc .fc-toolbar-chunk:nth-child(2) {
                        flex: 0 0 auto;
                        justify-content: center;
                        gap: 0;
                    }
                    
                    /* Right chunk (Prev, Today, Next) */
                    .fc .fc-toolbar-chunk:last-child {
                        flex: 0 0 auto;
                        justify-content: flex-end;
                        gap: 4px;
                    }
                    
                    .fc-toolbar-chunk:last-child > .fc-button-group:first-child {
                        display: none; /* Hide standard month/week buttons if we're moving them to center */
                    }
                    
                    /* Custom M/W View Toggle in Center Chunk */
                    .fc .fc-dayGridMonth-button, .fc .fc-dayGridWeek-button {
                        padding: 0 !important;
                        width: 32px;
                        height: 32px !important;
                        font-size: 0 !important; /* Hide original text */
                        background: rgba(128, 128, 128, 0.08) !important;
                        border-radius: 8px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin: 0 !important;
                    }
                    .fc .fc-dayGridMonth-button.fc-button-active, .fc .fc-dayGridWeek-button.fc-button-active {
                        display: none !important; /* Hide the active one since it's a toggle */
                    }
                    .fc .fc-dayGridMonth-button:not(.fc-button-active)::after {
                        content: 'M';
                        font-size: 0.95rem;
                        font-weight: 600;
                        line-height: 1;
                    }
                    .fc .fc-dayGridWeek-button:not(.fc-button-active)::after {
                        content: 'W';
                        font-size: 0.95rem;
                        font-weight: 600;
                        line-height: 1;
                    }

                    /* Navigation buttons precise sizing */
                    .fc .fc-today-button {
                        padding: 0 10px !important;
                        font-size: 0.9rem !important;
                        height: 32px !important;
                    }
                    .fc .fc-prev-button, .fc .fc-next-button {
                        padding: 0 !important;
                        width: 32px;
                        height: 32px !important;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                }
            `}</style>
            <FullCalendar
                plugins={[dayGridPlugin, interactionPlugin]}
                initialView="dayGridMonth"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                events={events as any}
                eventClick={(info) => {
                    info.jsEvent.preventDefault(); // Prevent URL navigation just in case
                    info.jsEvent.stopPropagation();
                    const noteId = info.event.extendedProps.noteId;
                    if (noteId) onSelectNote(Number(noteId));
                }}
                eventContent={(arg) => {
                    return (
                        <button 
                            className="flex items-center gap-1.5 overflow-hidden w-full px-1 text-left"
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const noteId = arg.event.extendedProps.noteId;
                                if (noteId) onSelectNote(Number(noteId));
                            }}
                        >
                            {arg.event.extendedProps.icon && (
                                <span className="flex-shrink-0" style={{ fontSize: '1.2em' }}>{arg.event.extendedProps.icon}</span>
                            )}
                            <span className="truncate text-dark-bg/85 dark:text-light-bg/85">{arg.event.title}</span>
                        </button>
                    );
                }}
                height="600px"
                headerToolbar={{
                    left: 'title',
                    center: 'dayGridMonth,dayGridWeek',
                    right: 'prev,today,next'
                }}
            />
        </div>
    );
}

// ─── Gallery Card ─────────────────────────────────────────────────────────────
function GalleryView({
    notes,
    schema,
    onSelectNote,
}: {
    notes: RowData[];
    schema?: SmartSchema | null;
    onSelectNote: (id: number) => void;
}) {
    if (notes.length === 0) {
        return (
            <div style={{ padding: '40px 20px', textAlign: 'center', opacity: 0.35, fontSize: '0.85rem' }}>
                No notes in this folder yet.
            </div>
        );
    }

    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '14px',
                padding: '16px',
            }}
        >
            {notes.map(row => (
                <button
                    key={row.item.id}
                    onClick={() => onSelectNote(row.item.id!)}
                    className="group/card text-left rounded-xl border border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 hover:-translate-y-0.5 hover:shadow-xl dark:hover:shadow-black/40 transition-all duration-200 overflow-hidden focus:outline-none focus:ring-2 focus:ring-black/15 dark:focus:ring-white/15 dark:bg-dark-ui"
                    style={{
                        padding: '22px',
                        backgroundColor: 'var(--color-card-bg)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.6)',
                    }}
                >
                    {/* Icon + Title */}
                    <div className="flex items-start gap-2.5 mb-4">
                        {row.item.icon && (
                            <span style={{ fontSize: '1.5rem', lineHeight: 1, flexShrink: 0 }}>{row.item.icon}</span>
                        )}
                        <span
                            className="text-sm font-semibold text-dark-bg dark:text-light-bg leading-snug"
                            style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
                        >
                            {row.item.title || 'Untitled'}
                        </span>
                    </div>

                    {schema && (
                        <>
                            {/* Divider */}
                            {schema.fields.some(f => !!row.meta[f.name]) && (
                                <div style={{ borderTop: '1px solid rgba(128,128,128,0.12)', margin: '14px 0' }} />
                            )}

                            {/* Meta Fields */}
                            {schema.fields.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {schema.fields.map(f => {
                                        const val = row.meta[f.name] || '';
                                        if (!val) return null;
                                        return (
                                            <div key={f.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 0' }}>
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-dark-bg/35 dark:text-light-bg/30 shrink-0">
                                                    {f.name}
                                                </span>
                                                <span className="text-[11px] font-medium text-dark-bg/65 dark:text-light-bg/60 truncate text-right">
                                                    {f.type === 'checkbox' ? (val === 'true' ? '✓' : '✗') : val}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </button>
            ))}
        </div>
    );
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
function KanbanView({
    notes,
    schema,
    onSelectNote,
    onUpdateNote,
    onReorderNotes
}: {
    notes: RowData[];
    schema: SmartSchema;
    onSelectNote: (id: number) => void;
    onUpdateNote: (id: number, field: string, value: string) => void;
    onReorderNotes: (updates: { id: number; order: number }[]) => void;
}) {
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
        <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
        >
            <div className="flex h-[600px] overflow-x-auto overflow-y-hidden p-4 gap-4 scrollbar-thin scrollbar-thumb-light-border dark:scrollbar-thumb-dark-border">
                {columnOrder.map(colName => {
                    const colNotes = columns[colName] ?? [];
                    const isOver = overColNameState === colName;
                    return (
                        <KanbanColumn
                            key={colName}
                            colName={colName}
                            colNotes={colNotes}
                            isOver={isOver}
                            schema={schema}
                            selectField={selectField}
                            onSelectNote={onSelectNote}
                        />
                    );
                })}
            </div>

            {/* Drag Overlay — rendered on top of everything, follows cursor */}
            {createPortal(
                <DragOverlay
                    modifiers={[snapCenterToCursor]}
                    dropAnimation={{
                        duration: 220,
                        easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
                    }}
                >
                    {activeRow ? (
                        <KanbanCard
                            row={activeRow}
                            schema={schema}
                            selectField={selectField}
                            onSelectNote={onSelectNote}
                            isDragOverlay
                        />
                    ) : null}
                </DragOverlay>,
                document.body
            )}
        </DndContext>
    );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ folderName, tagName, onSelectNote, viewMode, onHasDateField, onHasSelectField }: DashboardProps) {
    const [targetFolder, setTargetFolder] = useState<NoteItem | null>(null);
    const [schema, setSchema]             = useState<SmartSchema | null>(null);
    const [notes, setNotes]               = useState<RowData[]>([]);
    const [isLoading, setIsLoading]       = useState(true);
    const [hoveredRow, setHoveredRow]     = useState<number | null>(null);
    const [sorting, setSorting]           = useState<SortingState>([]);

    const loadData = useCallback(async () => {
        setIsLoading(true);
        
        let active: NoteItem[] = [];
        let folderSchema: SmartSchema | null = null;

        if (tagName) {
            // Tag-based filtering
            const children = await db.items.where('tags').equals(tagName).filter(item => !item.isDeleted && item.type === 'note').toArray();
            active = children;
            // For now, tag view doesn't have a specific folder schema, 
            // but we could eventually infer one or use a default.
            setTargetFolder({ id: -1, title: `#${tagName}`, type: 'folder', parentId: 0, updated_at: Date.now() }); 
        } else if (folderName) {
            // Folder-based logic
            const folders = await db.items.where({ type: 'folder', title: folderName }).toArray();
            const folder  = folders.find(f => !f.isDeleted);
            if (!folder?.id) { setIsLoading(false); return; }
            setTargetFolder(folder);

            folderSchema = await readSchema(folder.id);
            const children = await db.items.where({ parentId: folder.id, type: 'note' }).toArray();
            active = children.filter(n => !n.isDeleted);
        }

        active.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        setSchema(folderSchema);

        if (folderSchema) {
            onHasDateField(folderSchema.fields.some(f => f.type === 'date'));
            onHasSelectField(folderSchema.fields.some(f => f.type === 'select'));
        } else {
            onHasDateField(false);
            onHasSelectField(false);
        }

        const data = await Promise.all(active.map(async n => {
            const c = await db.contents.get(n.id!);
            const raw = c?.content || '';
            return { item: n, meta: parseYamlFrontmatter(raw).meta, rawContent: raw };
        }));
        setNotes(data);
        setIsLoading(false);
    }, [folderName, tagName, onHasDateField, onHasSelectField]);

    useEffect(() => {
        loadData();
    }, [loadData]);


    const handleReorderNotes = useCallback(async (updates: { id: number; order: number }[]) => {
        // Optimistically update local state to reflect the new order
        setNotes(prev => {
            const map = new Map(updates.map(u => [u.id, u.order]));
            const newNotes = prev.map(n => {
                if (map.has(n.item.id!)) {
                    return { ...n, item: { ...n.item, order: map.get(n.item.id!)! } };
                }
                return n;
            });
            return newNotes.sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0));
        });

        // Persist the changes to Dexie
        await db.transaction('rw', db.items, async () => {
            for (const { id, order } of updates) {
                await db.items.update(id, { order });
            }
        });
        
        triggerAutoSync();
    }, []);

    const handleCellChange = useCallback(async (noteId: number, key: string, val: string) => {
        // Optimistically update UI to prevent flashing/teleporting during async db writes
        setNotes(prev => prev.map(n => {
            if (n.item.id === noteId) {
                return { ...n, meta: { ...n.meta, [key]: val } };
            }
            return n;
        }));

        const contentObj = await db.contents.get(noteId);
        const targetItem = await db.items.get(noteId);
        if (!contentObj || !targetItem) return;

        const currentRaw = contentObj.content;
        const parsed = parseYamlFrontmatter(currentRaw);
        const newMeta = { ...parsed.meta, [key]: val };
        const newContent = serializeYamlFrontmatter(newMeta, parsed.body);

        await db.contents.put({ id: noteId, content: newContent });
        await db.items.update(noteId, { updated_at: Date.now() });
        
        // Final state update with proper rawContent to keep everything in perfect sync
        setNotes(prev => prev.map(n => n.item.id === noteId ? { ...n, meta: newMeta, rawContent: newContent } : n));

        const allItems = await db.items.toArray();
        const fullPath = getFullPath(noteId, allItems);
        updateSearchIndex(noteId, targetItem.title, newContent, targetItem.parentId, fullPath, targetItem.icon, targetItem.tags);
        
        if (getStorageMode() === 'vault') {
            const pp = getFullPath(targetItem.parentId, allItems);
            writeNoteToVault(notePathFromTitle(targetItem.title, pp), newContent).catch(console.warn);
        }
        
        localStorage.setItem('keim_has_user_edits', 'true');
        triggerAutoSync();

        window.dispatchEvent(new CustomEvent('keim_note_content_updated', {
            detail: { noteId, newContent }
        }));
    }, []);

    useEffect(() => {
        const handleNoteUpdated = ((e: CustomEvent) => {
            const { noteId: updatedId, newContent } = e.detail;
            
            setNotes(prev => {
                const existing = prev.find(n => n.item.id === updatedId);
                if (!existing || existing.rawContent === newContent) return prev;
                const { meta } = parseYamlFrontmatter(newContent);
                return prev.map(n => n.item.id === updatedId ? { ...n, meta, rawContent: newContent } : n);
            });
        }) as EventListener;
        window.addEventListener('keim_note_content_updated', handleNoteUpdated);
        return () => window.removeEventListener('keim_note_content_updated', handleNoteUpdated);
    }, []);

    const columns = useMemo(() => {
        if (!schema) return [];

        const cols = [
            columnHelper.accessor(row => row.item.title, {
                id: 'name',
                header: () => 'Name',
                minSize: 180,
                // Removed 'size' completely. TanStack will now auto-fit to content by default
                cell: info => {
                    const note = info.row.original;
                    return (
                        <button onClick={() => onSelectNote(note.item.id!)}
                            className="flex items-center gap-2 hover:text-indigo-500 dark:hover:text-indigo-400 text-dark-bg dark:text-light-bg transition-colors w-full text-left"
                            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
                            title={note.item.title || 'Untitled'}>
                            {note.item.icon && <span>{note.item.icon}</span>}
                            {info.getValue() || 'Untitled'}
                        </button>
                    )
                }
            })
        ];

        const fieldCols = schema.fields.map((f, i) => {
            const colId = f.name || `unnamed_${i}`;
            return columnHelper.accessor(row => row.meta[f.name] || '', {
                id: colId,
                header: () => f.name || '—',
                size: Math.max(colMinWidth(f.type), 150),
                minSize: colMinWidth(f.type),
                sortingFn: 'alphanumeric',
                cell: info => {
                    const row = info.row.original;
                    const val = info.getValue() as string;
                    
                    if (f.type === 'date') {
                        return <CellInput type="date" value={val}
                                onSave={(newVal: string) => handleCellChange(row.item.id!, f.name, newVal)}
                                style={{ ...baseInput, padding: CP, display: 'block' }}
                                className="text-dark-bg/80 dark:text-light-bg/80 w-full bg-transparent" />;
                    } else if (f.type === 'number') {
                        return <CellInput type="number" value={val} placeholder="—"
                                onSave={(newVal: string) => handleCellChange(row.item.id!, f.name, newVal)}
                                style={{ ...baseInput, padding: CP, display: 'block' }}
                                className="text-dark-bg/80 dark:text-light-bg/80 w-full bg-transparent" />;
                    } else if (f.type === 'checkbox') {
                        return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                <input type="checkbox" checked={val === 'true'}
                                    onChange={e => handleCellChange(row.item.id!, f.name, e.target.checked ? 'true' : 'false')}
                                    style={{ width: 15, height: 15, cursor: 'pointer' }}
                                    className="accent-indigo-500" />
                            </div>;
                    } else if (f.type === 'select') {
                        return <select value={val}
                                onChange={e => handleCellChange(row.item.id!, f.name, e.target.value)}
                                style={{ ...baseInput, padding: CP, display: 'block', cursor: 'pointer' }}
                                className="text-dark-bg/80 dark:text-light-bg/80 w-full bg-transparent">
                                <option value="" disabled hidden>—</option>
                                {(f.options || []).map((o, i) => <option key={`${o}-${i}`} value={o}>{o}</option>)}
                            </select>;
                    } else if (f.type === 'relation') {
                        return <div style={{ padding: CP, height: '100%', display: 'flex', alignItems: 'center' }}>
                                {val ? (
                                    <button onClick={e => {
                                            e.stopPropagation();
                                            const r = miniSearch.search(val, { fields: ['title'] });
                                            if (r.length > 0) onSelectNote(Number(r[0].id));
                                        }}
                                        className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 hover:underline text-sm font-medium"
                                        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
                                        title={val}>
                                        <FileText size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{val}</span>
                                    </button>
                                ) : <span style={{ opacity: 0.25 }}>—</span>}
                            </div>;
                    } else {
                        return <CellInput type="text" value={val} placeholder="—"
                                onSave={(newVal: string) => handleCellChange(row.item.id!, f.name, newVal)}
                                style={{ ...baseInput, padding: CP, display: 'block' }}
                                className="text-dark-bg/80 dark:text-light-bg/80 w-full bg-transparent"
                                title={val} />;
                    }
                }
            });
        });

        return [...cols, ...fieldCols];
    }, [schema, onSelectNote, handleCellChange]);

    // eslint-disable-next-line react-hooks/incompatible-library
    const table = useReactTable({
        data: notes,
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        columnResizeMode: 'onChange',
        enableColumnResizing: true,
    });


    /* ── state guards ── */
    if (isLoading) return (
        <div className="my-4 rounded-lg p-6 text-sm opacity-50 text-center animate-pulse">Loading dashboard…</div>
    );
    if (!targetFolder && folderName) return (
        <div className="my-4 rounded-lg border border-red-500/20 bg-red-500/5 text-red-500 p-4 text-sm">
            <strong>Dashboard Error:</strong> Folder "{folderName}" not found.
        </div>
    );
    if (!schema?.fields.length && folderName) return (
        <div className="my-4 rounded-lg border border-black/5 dark:border-white/10 p-4 text-sm opacity-60 bg-black/5 dark:bg-white/5">
            <strong>Dashboard:</strong> "{folderName}" has no Smart Fields yet.
        </div>
    );
    if (!notes.length && tagName) return (
        <div className="my-12 flex flex-col items-center justify-center opacity-40">
            <Tag size={48} strokeWidth={1} className="mb-4" />
            <p className="text-sm font-medium">No notes tagged with #{tagName}</p>
        </div>
    );


    return (
        <div className="md:rounded-lg rounded-none overflow-hidden bg-light-ui/40 dark:bg-dark-ui/40 backdrop-blur-md border-y md:border border-black/5 dark:border-white/5 md:ring-1 ring-black/5 dark:ring-white/10 flex flex-col">

            {/* ── Gallery View ── */}
            {viewMode === 'gallery' && schema && (
                <GalleryView notes={notes} schema={schema} onSelectNote={onSelectNote} />
            )}

            {/* ── Calendar View ── */}
            {viewMode === 'calendar' && schema && (
                <CalendarView notes={notes} schema={schema} onSelectNote={onSelectNote} />
            )}

            {/* ── Kanban View ── */}
            {viewMode === 'kanban' && schema && (
                <KanbanView notes={notes} schema={schema} onSelectNote={onSelectNote} onUpdateNote={handleCellChange} onReorderNotes={handleReorderNotes} />
            )}

            {/* ── Table View ── */}
            {viewMode === 'table' && (
            <div style={{ overflowX: 'auto', width: '100%' }} className="scrollbar-thin scrollbar-thumb-light-border dark:scrollbar-thumb-dark-border">
                <table style={{
                    borderCollapse: 'collapse', fontSize: '0.84rem',
                    tableLayout: 'fixed', width: table.getTotalSize(), minWidth: '100%'
                }}>
                    <thead>
                        {table.getHeaderGroups().map(headerGroup => (
                            <tr key={headerGroup.id} style={{ borderBottom: BD }} className="text-dark-bg/50 dark:text-light-bg/40 bg-dark-bg/[0.025] dark:bg-white/[0.025]">
                                {headerGroup.headers.map(header => {
                                    const isNameCol = header.id === 'name';
                                    return (
                                        <th key={header.id} 
                                            style={{ 
                                                width: header.getSize(),
                                                padding: HP, fontWeight: 600, textAlign: 'left', fontSize: '0.75rem',
                                                letterSpacing: '0.06em', textTransform: 'uppercase',
                                                borderRight: isNameCol ? BD : 'none',
                                                borderLeft: !isNameCol && header.index > 0 ? BD : 'none',
                                                position: isNameCol ? 'sticky' : 'relative',
                                                left: isNameCol ? 0 : 'auto',
                                                zIndex: isNameCol ? 10 : 1
                                            }}
                                            className={`group hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${isNameCol ? 'bg-light-bg/95 dark:bg-dark-bg/95 backdrop-blur-sm' : ''}`}
                                        >
                                            <div 
                                                className="flex items-center justify-between gap-2 h-full cursor-pointer select-none"
                                                onClick={header.column.getToggleSortingHandler()}
                                            >
                                                <div className="flex items-center gap-1.5 overflow-hidden">
                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                                    </span>
                                                    {{
                                                        asc: <ArrowUp size={12} className="text-indigo-500 shrink-0" />,
                                                        desc: <ArrowDown size={12} className="text-indigo-500 shrink-0" />,
                                                    }[header.column.getIsSorted() as string] ?? (
                                                        <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-30 shrink-0" />
                                                    )}
                                                </div>
                                            </div>
                                            
                                            {/* Resize Handle */}
                                            <div
                                                onMouseDown={header.getResizeHandler()}
                                                onTouchStart={header.getResizeHandler()}
                                                className={`absolute right-0 top-0 h-full w-2 cursor-col-resize select-none touch-none hover:bg-indigo-500/50 flex items-center justify-center -mr-1 z-20 ${header.column.getIsResizing() ? 'bg-indigo-500' : ''}`}
                                            >
                                                <div className="w-[1px] h-4 bg-black/20 dark:bg-white/20" />
                                            </div>
                                        </th>
                                    );
                                })}
                            </tr>
                        ))}
                    </thead>

                    <tbody>
                        {table.getRowModel().rows.map((row, ri) => (
                            <tr key={row.id}
                                style={{ borderTop: ri === 0 ? 'none' : BD }}
                                className="transition-colors group/row"
                                onMouseEnter={() => setHoveredRow(row.original.item.id!)}
                                onMouseLeave={() => setHoveredRow(null)}>
                                {row.getVisibleCells().map(cell => {
                                    const isNameCol = cell.column.id === 'name';
                                    const isHovered = hoveredRow === row.original.item.id;
                                    const isDark = document.documentElement.classList.contains('dark');
                                    
                                    let bg = 'transparent';
                                    if (isNameCol) {
                                        bg = isHovered 
                                            ? (isDark ? '#27272a' : '#f2f2fb') // matching slate-800 / indigo-50 approx
                                            : (isDark ? '#18181b' : '#f9f9f9');
                                    } else if (isHovered) {
                                        bg = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)';
                                    }

                                    return (
                                        <td key={cell.id} 
                                            style={{ 
                                                width: cell.column.getSize(),
                                                borderRight: isNameCol ? BD : 'none', 
                                                borderLeft: !isNameCol && cell.column.getIndex() > 0 ? BD : 'none',
                                                overflow: 'hidden', 
                                                verticalAlign: 'middle',
                                                padding: (cell.column.columnDef.meta as Record<string, unknown>)?.isCheckbox ? CP : 0,
                                                position: isNameCol ? 'sticky' : 'static',
                                                left: isNameCol ? 0 : 'auto',
                                                zIndex: isNameCol ? 2 : 1,
                                                backgroundColor: bg
                                            }}
                                        >
                                            <div className="h-full w-full flex items-center" style={{ padding: cell.column.id === 'name' ? CP : 0 }}>
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                        {notes.length === 0 && (
                            <tr><td colSpan={table.getAllColumns().length}
                                style={{ padding: '28px 20px', textAlign: 'center', opacity: 0.35, fontSize: '0.85rem' }}>
                                No notes in this folder yet.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            )}
        </div>
    );
}
