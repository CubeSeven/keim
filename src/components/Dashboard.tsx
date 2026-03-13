import { useState, useEffect, useRef, useCallback } from 'react';
import { db, getFullPath, type NoteItem } from '../lib/db';
import { readSchema, parseYamlFrontmatter, serializeYamlFrontmatter } from '../lib/smartProps';
import type { SmartSchema } from '../lib/db';
import { updateSearchIndex, miniSearch } from '../lib/search';
import { triggerAutoSync } from '../lib/sync';
import { getStorageMode, writeNoteToVault, notePathFromTitle } from '../lib/vault';
import { FileText } from 'lucide-react';

interface DashboardProps {
    folderName: string;
    onSelectNote: (id: number) => void;
}

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

export default function Dashboard({ folderName, onSelectNote }: DashboardProps) {
    const [targetFolder, setTargetFolder] = useState<NoteItem | null>(null);
    const [schema, setSchema]             = useState<SmartSchema | null>(null);
    const [notes, setNotes]               = useState<{ item: NoteItem; meta: Record<string, string>; rawContent: string }[]>([]);
    const [isLoading, setIsLoading]       = useState(true);
    const [colWidths, setColWidths]       = useState<number[]>([]);
    const [hoveredRow, setHoveredRow]     = useState<number | null>(null);
    const resizingCol = useRef<{ index: number; startX: number; startW: number } | null>(null);

    useEffect(() => {
        let ok = true;
        async function load() {
            const folders = await db.items.where({ type: 'folder', title: folderName }).toArray();
            const folder  = folders.find(f => !f.isDeleted);
            if (!folder?.id) { if (ok) setIsLoading(false); return; }
            if (ok) setTargetFolder(folder);

            const folderSchema = await readSchema(folder.id);
            if (ok) setSchema(folderSchema);

            if (folderSchema) {
                const children = await db.items.where({ parentId: folder.id, type: 'note' }).toArray();
                const active   = children.filter(n => !n.isDeleted);
                const data     = await Promise.all(active.map(async n => {
                    const c = await db.contents.get(n.id!);
                    const raw = c?.content || '';
                    return { item: n, meta: parseYamlFrontmatter(raw).meta, rawContent: raw };
                }));
                if (ok) setNotes(data);

                // ── Content-aware column widths ──────────────────────────────
                // Use canvas to measure the actual pixel width of text values so
                // each column starts wide enough for its longest entry.
                const FONT = '13.4px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                const PAD  = 48; // left + right cell padding + a little breathing room
                const MAX  = 380;

                function measure(texts: string[]): number {
                    try {
                        const ctx = document.createElement('canvas').getContext('2d')!;
                        ctx.font = FONT;
                        return Math.min(MAX, Math.max(...texts.map(t => ctx.measureText(t).width)) + PAD);
                    } catch { return 0; }
                }

                // Name column: measure all note titles
                const nameW = Math.max(
                    120,
                    measure(['Name', ...active.map(n => n.title || 'Untitled')])
                );

                // Field columns: measure header name vs all cell values
                const fieldWidths = folderSchema.fields.map(f => {
                    const typeMin = colMinWidth(f.type);
                    if (f.type === 'checkbox') return typeMin;
                    const values = [f.name, ...data.map(n => n.meta[f.name] || '')];
                    return Math.max(typeMin, measure(values));
                });

                if (ok) setColWidths([nameW, ...fieldWidths]);
            }
            if (ok) setIsLoading(false);
        }
        load();
        return () => { ok = false; };
    }, [folderName]);

    /* ── resize ── */
    const onMove = useCallback((e: MouseEvent) => {
        if (!resizingCol.current) return;
        const { index, startX, startW } = resizingCol.current;
        const min = index === 0 ? 90 : 60;
        setColWidths(prev => {
            const next = [...prev];
            next[index] = Math.max(min, startW + (e.clientX - startX));
            return next;
        });
    }, []);

    const onUp = useCallback(function onUp() {
        resizingCol.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }, [onMove]);

    function startResize(i: number, e: React.MouseEvent) {
        e.preventDefault();
        resizingCol.current = { index: i, startX: e.clientX, startW: colWidths[i] ?? 160 };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    /* ── cell save ── */
    async function handleCellChange(noteId: number, key: string, val: string) {
        setNotes(prev => prev.map(n => n.item.id === noteId ? { ...n, meta: { ...n.meta, [key]: val } } : n));
        const target = notes.find(n => n.item.id === noteId);
        if (!target) return;
        const newMeta    = { ...target.meta, [key]: val };
        const newContent = serializeYamlFrontmatter(newMeta, parseYamlFrontmatter(target.rawContent).body);
        await db.contents.put({ id: noteId, content: newContent });
        await db.items.update(noteId, { updated_at: Date.now() });
        const allItems = await db.items.toArray();
        const fullPath = getFullPath(noteId, allItems);
        updateSearchIndex(noteId, target.item.title, newContent, target.item.parentId, fullPath, target.item.icon, target.item.tags);
        if (getStorageMode() === 'vault') {
            const pp = getFullPath(target.item.parentId, allItems);
            writeNoteToVault(notePathFromTitle(target.item.title, pp), newContent).catch(console.warn);
        }
        localStorage.setItem('keim_has_user_edits', 'true');
        triggerAutoSync();
        setNotes(prev => prev.map(n => n.item.id === noteId ? { ...n, rawContent: newContent } : n));
    }

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

    /* ── shared style values ── */
    const HP = '11px 18px'; // header padding
    const CP = '10px 18px'; // cell padding
    const BD = '1px solid rgba(128,128,128,0.12)';

    return (
        <div className="rounded-xl overflow-hidden bg-light-ui/40 dark:bg-dark-ui/40 backdrop-blur-md border border-black/5 dark:border-white/5 ring-1 ring-black/5 dark:ring-white/10"
>
            <div style={{ overflowX: 'auto' }}>
                <table style={{
                    borderCollapse: 'collapse', fontSize: '0.84rem',
                    tableLayout: 'fixed', width: 'max-content', minWidth: '100%',
                }}>
                    <colgroup>
                        <col style={{ width: colWidths[0] ?? 180 }} />
                        {schema.fields.map((f, i) => <col key={f.name} style={{ width: colWidths[i+1] ?? colMinWidth(f.type) }} />)}
                    </colgroup>

                    <thead>
                        <tr style={{ borderBottom: BD }} className="text-dark-bg/50 dark:text-light-bg/40 bg-dark-bg/[0.025] dark:bg-white/[0.025]">
                            {/* Name col header */}
                            <th style={{ padding: HP, fontWeight: 600, textAlign: 'left', fontSize: '0.75rem',
                                letterSpacing: '0.06em', textTransform: 'uppercase',
                                borderRight: BD, position: 'sticky', left: 0, zIndex: 3 }}
                                className="bg-light-ui dark:bg-[#18181b] group">
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                                    <span>Name</span>
                                    <span onMouseDown={e => startResize(0, e)}
                                        style={{ cursor: 'col-resize', opacity: 0.22, padding: '0 3px', lineHeight: 1, flexShrink: 0,
                                                 userSelect: 'none', fontSize: '11px' }}
                                        title="Drag to resize">⠿</span>
                                </div>
                            </th>
                            {schema.fields.map((f, i) => (
                                <th key={f.name} style={{ padding: HP, fontWeight: 600, textAlign: 'left', fontSize: '0.75rem',
                                    letterSpacing: '0.06em', textTransform: 'uppercase', borderLeft: BD }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                        <span onMouseDown={e => startResize(i+1, e)}
                                            style={{ cursor: 'col-resize', opacity: 0.25, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}>⠿</span>
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>

                    <tbody>
                        {notes.map((note, ri) => (
                            <tr key={note.item.id}
                                style={{ borderTop: ri === 0 ? 'none' : BD }}
                                className="transition-colors"
                                onMouseEnter={() => setHoveredRow(note.item.id!)}
                                onMouseLeave={() => setHoveredRow(null)}>
                                {/* Name sticky cell */}
                                <td style={{ padding: CP, fontWeight: 500, position: 'sticky', left: 0, zIndex: 2, borderRight: BD, overflow: 'hidden',
                                             backgroundColor: hoveredRow === note.item.id
                                                 ? (document.documentElement.classList.contains('dark') ? '#1e1e25' : '#f2f2fb')
                                                 : (document.documentElement.classList.contains('dark') ? '#18181b' : '#f9f9f9') }}>
                                    <button onClick={() => onSelectNote(note.item.id!)}
                                        className="flex items-center gap-2 hover:text-indigo-500 dark:hover:text-indigo-400 text-dark-bg dark:text-light-bg transition-colors"
                                        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
                                        title={note.item.title}>
                                        {note.item.icon && <span>{note.item.icon}</span>}
                                        {note.item.title || 'Untitled'}
                                    </button>
                                </td>

                                {schema.fields.map(f => {
                                    const val = note.meta[f.name] || '';
                                    return (
                                        <td key={f.name} style={{ borderLeft: BD, overflow: 'hidden', verticalAlign: 'middle',
                                            padding: f.type === 'checkbox' ? CP : 0 }}>
                                            {f.type === 'date' ? (
                                                <input type="date" value={val}
                                                    onChange={e => handleCellChange(note.item.id!, f.name, e.target.value)}
                                                    style={{ ...baseInput, padding: CP, display: 'block' }}
                                                    className="text-dark-bg/80 dark:text-light-bg/80" />
                                            ) : f.type === 'number' ? (
                                                <input type="number" value={val} placeholder="—"
                                                    onChange={e => handleCellChange(note.item.id!, f.name, e.target.value)}
                                                    style={{ ...baseInput, padding: CP, display: 'block' }}
                                                    className="text-dark-bg/80 dark:text-light-bg/80" />
                                            ) : f.type === 'checkbox' ? (
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <input type="checkbox" checked={val === 'true'}
                                                        onChange={e => handleCellChange(note.item.id!, f.name, e.target.checked ? 'true' : 'false')}
                                                        style={{ width: 15, height: 15, cursor: 'pointer' }}
                                                        className="accent-indigo-500" />
                                                </div>
                                            ) : f.type === 'select' ? (
                                                <select value={val}
                                                    onChange={e => handleCellChange(note.item.id!, f.name, e.target.value)}
                                                    style={{ ...baseInput, padding: CP, display: 'block', cursor: 'pointer' }}
                                                    className="text-dark-bg/80 dark:text-light-bg/80">
                                                    <option value="" disabled hidden>—</option>
                                                    {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                                                </select>
                                            ) : f.type === 'relation' ? (
                                                <div style={{ padding: CP }}>
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
                                                </div>
                                            ) : (
                                                <input type="text" value={val} placeholder="—"
                                                    onChange={e => handleCellChange(note.item.id!, f.name, e.target.value)}
                                                    style={{ ...baseInput, padding: CP, display: 'block' }}
                                                    className="text-dark-bg/80 dark:text-light-bg/80"
                                                    title={val} />
                                            )}
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
        </div>
    );
}
