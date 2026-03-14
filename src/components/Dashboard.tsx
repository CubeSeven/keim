import { useState, useEffect, useMemo, useCallback } from 'react';
import { db, getFullPath, type NoteItem } from '../lib/db';
import { readSchema, parseYamlFrontmatter, serializeYamlFrontmatter } from '../lib/smartProps';
import type { SmartSchema } from '../lib/db';
import { updateSearchIndex, miniSearch } from '../lib/search';
import { triggerAutoSync } from '../lib/sync';
import { getStorageMode, writeNoteToVault, notePathFromTitle } from '../lib/vault';
import { FileText, Plus, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import type { SortingState } from '@tanstack/react-table';

interface DashboardProps {
    folderName: string;
    onSelectNote: (id: number) => void;
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

export default function Dashboard({ folderName, onSelectNote }: DashboardProps) {
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
                size: 250,
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
        <div className="rounded-xl overflow-hidden bg-light-ui/40 dark:bg-dark-ui/40 backdrop-blur-md border border-black/5 dark:border-white/5 ring-1 ring-black/5 dark:ring-white/10 flex flex-col">
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
                                                position: 'relative'
                                            }}
                                            className={`group hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${isNameCol ? 'sticky left-0 z-10 bg-light-ui dark:bg-[#18181b]' : ''}`}
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

            {/* Premium Table Footer Actions */}
            <div className="border-t border-black/5 dark:border-white/5 bg-light-ui/50 dark:bg-dark-ui/50 p-2 flex items-center justify-between">
                <button
                    onClick={handleAddNote}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-dark-bg/60 dark:text-light-bg/60 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-md transition-colors"
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
