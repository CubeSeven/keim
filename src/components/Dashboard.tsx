import { useState, useEffect, useMemo, useCallback } from 'react';
import { db, getFullPath, type NoteItem } from '../lib/db';
import { readSchema, parseYamlFrontmatter, serializeYamlFrontmatter } from '../lib/smartProps';
import type { SmartSchema } from '../lib/db';
import { updateSearchIndex, miniSearch } from '../lib/search';
import { triggerAutoSync } from '../lib/sync';
import { getStorageMode, writeNoteToVault, notePathFromTitle } from '../lib/vault';
import { FileText, Plus, ArrowDown, ArrowUp, ArrowUpDown, CalendarDays } from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import type { SortingState } from '@tanstack/react-table';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';

export type ViewMode = 'table' | 'gallery' | 'calendar';

interface DashboardProps {
    folderName: string;
    onSelectNote: (id: number) => void;
    viewMode: ViewMode;
    switchView: (mode: ViewMode) => void;
    onHasDateField: (has: boolean) => void;
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
    const [selectedDay, setSelectedDay] = useState<Date | undefined>(undefined);

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

    // Build map: ISO date string → notes
    const notesByDate = useMemo(() => {
        const map = new Map<string, RowData[]>();
        notes.forEach(row => {
            const val = row.meta[dateField.name];
            if (val) {
                const existing = map.get(val) || [];
                map.set(val, [...existing, row]);
            }
        });
        return map;
    }, [notes, dateField.name]);

    // Days that have notes — for DayPicker modifiers
    const daysWithNotes = useMemo(() => {
        return Array.from(notesByDate.keys()).map(ds => {
            const [y, m, d] = ds.split('-').map(Number);
            return new Date(y, m - 1, d);
        });
    }, [notesByDate]);

    const selectedDayStr = selectedDay
        ? `${selectedDay.getFullYear()}-${String(selectedDay.getMonth() + 1).padStart(2, '0')}-${String(selectedDay.getDate()).padStart(2, '0')}`
        : null;
    const selectedNotes = selectedDayStr ? (notesByDate.get(selectedDayStr) || []) : [];

    return (
        <div className="flex flex-col sm:flex-row gap-0 sm:gap-0 min-h-0">
            {/* Calendar picker */}
            <div className="flex justify-center px-2 py-3 border-b sm:border-b-0 sm:border-r border-black/5 dark:border-white/5">
                <DayPicker
                    mode="single"
                    selected={selectedDay}
                    onSelect={setSelectedDay}
                    modifiers={{ hasNotes: daysWithNotes }}
                    modifiersClassNames={{ hasNotes: 'rdp-has-notes' }}
                    showOutsideDays
                    captionLayout="dropdown"
                />
            </div>

            {/* Day detail panel */}
            <div className="flex-1 p-4 min-w-0">
                {selectedDay ? (
                    selectedNotes.length > 0 ? (
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-widest text-dark-bg/40 dark:text-light-bg/40 mb-3">
                                {selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                                <span className="ml-2 text-dark-bg/25 dark:text-light-bg/25">{selectedNotes.length} note{selectedNotes.length !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="space-y-2">
                                {selectedNotes.map(row => (
                                    <button
                                        key={row.item.id}
                                        onClick={() => onSelectNote(row.item.id!)}
                                        className="w-full text-left px-3 py-2.5 rounded-lg border border-black/8 dark:border-white/8 hover:border-black/15 dark:hover:border-white/15 bg-light-bg/60 dark:bg-dark-bg/60 hover:bg-light-bg dark:hover:bg-dark-bg transition-all group/note"
                                    >
                                        <div className="flex items-center gap-2">
                                            {row.item.icon && <span>{row.item.icon}</span>}
                                            <span className="text-sm font-medium text-dark-bg dark:text-light-bg group-hover/note:text-black dark:group-hover/note:text-white transition-colors">
                                                {row.item.title || 'Untitled'}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-sm text-dark-bg/35 dark:text-light-bg/35">
                            No notes for this day.
                        </div>
                    )
                ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
                        <CalendarDays size={28} className="text-dark-bg/20 dark:text-light-bg/20" />
                        <div className="text-sm text-dark-bg/35 dark:text-light-bg/35">
                            Select a day to see notes
                        </div>
                        {daysWithNotes.length > 0 && (
                            <div className="text-xs text-dark-bg/25 dark:text-light-bg/25">
                                {daysWithNotes.length} day{daysWithNotes.length !== 1 ? 's' : ''} with notes
                            </div>
                        )}
                    </div>
                )}
            </div>
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
    schema: SmartSchema;
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
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '14px',
                padding: '16px',
            }}
        >
            {notes.map(row => (
                <button
                    key={row.item.id}
                    onClick={() => onSelectNote(row.item.id!)}
                    className="group/card text-left rounded-xl border border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 hover:-translate-y-0.5 hover:shadow-xl dark:hover:shadow-black/40 transition-all duration-200 overflow-hidden focus:outline-none focus:ring-2 focus:ring-black/15 dark:focus:ring-white/15 bg-light-bg/75 dark:bg-dark-ui/80"
                    style={{
                        padding: '16px',
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.6)',
                    }}
                >
                    {/* Icon + Title */}
                    <div className="flex items-start gap-2.5 mb-3">
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

                    {/* Divider */}
                    {schema.fields.some(f => !!row.meta[f.name]) && (
                        <div className="border-t border-black/8 dark:border-white/8 mb-2.5" />
                    )}

                    {/* Meta Fields */}
                    {schema.fields.length > 0 && (
                        <div className="space-y-1.5">
                            {schema.fields.map(f => {
                                const val = row.meta[f.name] || '';
                                if (!val) return null;
                                return (
                                    <div key={f.name} className="flex items-center justify-between gap-2 min-w-0">
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
                </button>
            ))}
        </div>
    );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ folderName, onSelectNote, viewMode, onHasDateField }: DashboardProps) {
    const [targetFolder, setTargetFolder] = useState<NoteItem | null>(null);
    const [schema, setSchema]             = useState<SmartSchema | null>(null);
    const [notes, setNotes]               = useState<RowData[]>([]);
    const [isLoading, setIsLoading]       = useState(true);
    const [hoveredRow, setHoveredRow]     = useState<number | null>(null);
    const [sorting, setSorting]           = useState<SortingState>([]);

    const loadData = useCallback(async () => {
        const folders = await db.items.where({ type: 'folder', title: folderName }).toArray();
        const folder  = folders.find(f => !f.isDeleted);
        if (!folder?.id) { setIsLoading(false); return; }
        setTargetFolder(folder);

        const folderSchema = await readSchema(folder.id);
        setSchema(folderSchema);

        if (folderSchema) {
            onHasDateField(folderSchema.fields.some(f => f.type === 'date'));
            const children = await db.items.where({ parentId: folder.id, type: 'note' }).toArray();
            const active   = children.filter(n => !n.isDeleted);
            const data     = await Promise.all(active.map(async n => {
                const c = await db.contents.get(n.id!);
                const raw = c?.content || '';
                return { item: n, meta: parseYamlFrontmatter(raw).meta, rawContent: raw };
            }));
            setNotes(data);
        }
        setIsLoading(false);
    }, [folderName]);

    useEffect(() => {
        loadData();
    }, [loadData]);


    const handleCellChange = useCallback(async (noteId: number, key: string, val: string) => {
        const contentObj = await db.contents.get(noteId);
        const targetItem = await db.items.get(noteId);
        if (!contentObj || !targetItem) return;

        const currentRaw = contentObj.content;
        const parsed = parseYamlFrontmatter(currentRaw);
        const newMeta = { ...parsed.meta, [key]: val };
        const newContent = serializeYamlFrontmatter(newMeta, parsed.body);

        await db.contents.put({ id: noteId, content: newContent });
        await db.items.update(noteId, { updated_at: Date.now() });
        
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

    const handleAddNote = async () => {
      if (!targetFolder?.id) return;
      const { addItem } = await import('../lib/db');
      const id = await addItem({ parentId: targetFolder.id, type: 'note', title: 'New Note' }, '');
      localStorage.setItem('keim_has_user_edits', 'true');
  
      if (getStorageMode() === 'vault') {
        try {
          const { writeNoteToVault, notePathFromTitle } = await import('../lib/vault');
          const { getItemPath } = await import('../lib/db');
          const allItems = await db.items.toArray();
          const parentPath = getItemPath(targetFolder.id, allItems);
          const notePath = notePathFromTitle('New Note', parentPath);
          await writeNoteToVault(notePath, '');
        } catch (e) {
          console.warn('Could not write new note to vault immediately', e);
        }
      }
      
      triggerAutoSync();
      onSelectNote(id as number);
      // Give it time to render the editor then focus title
      setTimeout(() => window.dispatchEvent(new CustomEvent('keim_focus_title', { detail: id })), 150);
    };

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
    if (!targetFolder) return (
        <div className="my-4 rounded-lg border border-red-500/20 bg-red-500/5 text-red-500 p-4 text-sm">
            <strong>Dashboard Error:</strong> Folder "{folderName}" not found.
        </div>
    );
    if (!schema?.fields.length) return (
        <div className="my-4 rounded-lg border border-black/5 dark:border-white/10 p-4 text-sm opacity-60 bg-black/5 dark:bg-white/5">
            <strong>Dashboard:</strong> "{folderName}" has no Smart Fields yet.
        </div>
    );


    return (
        <div className="rounded-lg overflow-hidden bg-light-ui/40 dark:bg-dark-ui/40 backdrop-blur-md border border-black/5 dark:border-white/5 ring-1 ring-black/5 dark:ring-white/10 flex flex-col">

            {/* ── Gallery View ── */}
            {viewMode === 'gallery' && (
                <GalleryView notes={notes} schema={schema!} onSelectNote={onSelectNote} />
            )}

            {/* ── Calendar View ── */}
            {viewMode === 'calendar' && (
                <CalendarView notes={notes} schema={schema!} onSelectNote={onSelectNote} />
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
                            <tr><td colSpan={schema.fields.length + 1}
                                style={{ padding: '28px 20px', textAlign: 'center', opacity: 0.35, fontSize: '0.85rem' }}>
                                No notes in this folder yet.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            )}

            {/* Premium Table Footer Actions */}
            <div className="border-t border-black/5 dark:border-white/5 bg-light-ui/50 dark:bg-dark-ui/50 !px-4 !py-3 flex items-center justify-between">
                <button
                    onClick={handleAddNote}
                    className="flex items-center gap-1.5 !px-3 !py-1.5 text-xs font-semibold text-dark-bg/70 dark:text-light-bg/70 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-md transition-colors"
                >
                    <Plus size={14} /> New Note
                </button>
                <div className="text-[10px] font-medium text-dark-bg/30 dark:text-light-bg/30 uppercase tracking-widest px-2">
                    {notes.length} Item{notes.length !== 1 ? 's' : ''}
                </div>
            </div>
        </div>
    );
}
