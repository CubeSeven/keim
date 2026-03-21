import { useState, useEffect, useCallback } from 'react';
import { db, getFullPath, type NoteItem } from '../lib/db';
import { readSchema, parseYamlFrontmatter, serializeYamlFrontmatter } from '../lib/smartProps';
import type { SmartSchema } from '../lib/db';
import { updateSearchIndex } from '../lib/search';
import { triggerAutoSync } from '../lib/sync';
import { getStorageMode, writeNoteToVault, notePathFromTitle } from '../lib/vault';
import { Tag } from 'lucide-react';

// Extracted views
import { type RowData } from './dashboard/types';
import { CalendarView } from './dashboard/CalendarView';
import { GalleryView } from './dashboard/GalleryView';
import { KanbanView } from './dashboard/KanbanView';
import { TableView } from './dashboard/TableView';

export type ViewMode = 'table' | 'gallery' | 'calendar' | 'kanban';

interface DashboardProps {
    folderName?: string;
    tagName?: string | null;
    onSelectNote: (id: number) => void;
    viewMode: ViewMode;
    onHasDateField: (has: boolean) => void;
    onHasSelectField: (has: boolean) => void;
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard({ folderName, tagName, onSelectNote, viewMode, onHasDateField, onHasSelectField }: DashboardProps) {
    const [targetFolder, setTargetFolder] = useState<NoteItem | null>(null);
    const [schema, setSchema]             = useState<SmartSchema | null>(null);
    const [notes, setNotes]               = useState<RowData[]>([]);
    const [isLoading, setIsLoading]       = useState(true);

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
                <TableView notes={notes} schema={schema} onSelectNote={onSelectNote} onUpdateNote={handleCellChange} />
            )}
        </div>
    );
}
