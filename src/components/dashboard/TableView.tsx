import { useState, useMemo } from 'react';
import { type DashboardViewProps, type RowData } from './types';
import { FileText, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState
} from '@tanstack/react-table';
import { CellInput } from './CellInput';
import { miniSearch } from '../../lib/search';

interface TableViewProps extends DashboardViewProps {
    onUpdateNote: (id: number, field: string, value: string) => void;
}

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

const HP = '11px 18px'; // header padding
const CP = '10px 18px'; // cell padding
const BD = '1px solid rgba(128,128,128,0.12)';

export function TableView({
    notes,
    schema,
    onSelectNote,
    onUpdateNote
}: TableViewProps) {
    const [hoveredRow, setHoveredRow] = useState<number | null>(null);
    const [sorting, setSorting] = useState<SortingState>([]);
    
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
                                onSave={(newVal: string) => onUpdateNote(row.item.id!, f.name, newVal)}
                                style={{ ...baseInput, padding: CP, display: 'block' }}
                                className="text-dark-bg/80 dark:text-light-bg/80 w-full bg-transparent" />;
                    } else if (f.type === 'number') {
                        return <CellInput type="number" value={val} placeholder="—"
                                onSave={(newVal: string) => onUpdateNote(row.item.id!, f.name, newVal)}
                                style={{ ...baseInput, padding: CP, display: 'block' }}
                                className="text-dark-bg/80 dark:text-light-bg/80 w-full bg-transparent" />;
                    } else if (f.type === 'checkbox') {
                        return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                <input type="checkbox" checked={val === 'true'}
                                    onChange={e => onUpdateNote(row.item.id!, f.name, e.target.checked ? 'true' : 'false')}
                                    style={{ width: 15, height: 15, cursor: 'pointer' }}
                                    className="accent-indigo-500" />
                            </div>;
                    } else if (f.type === 'select') {
                        return <select value={val}
                                onChange={e => onUpdateNote(row.item.id!, f.name, e.target.value)}
                                style={{ ...baseInput, padding: CP, display: 'block', cursor: 'pointer' }}
                                className="text-dark-bg/80 dark:text-light-bg/80 w-full bg-transparent">
                                <option value="" disabled hidden>—</option>
                                {(f.options || []).map((o, idx) => <option key={`${o}-${idx}`} value={o}>{o}</option>)}
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
                                onSave={(newVal: string) => onUpdateNote(row.item.id!, f.name, newVal)}
                                style={{ ...baseInput, padding: CP, display: 'block' }}
                                className="text-dark-bg/80 dark:text-light-bg/80 w-full bg-transparent"
                                title={val} />;
                    }
                }
            });
        });

        return [...cols, ...fieldCols];
    }, [schema, onSelectNote, onUpdateNote]);

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

    return (
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
    );
}
