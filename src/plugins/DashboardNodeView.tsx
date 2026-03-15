import { useState } from 'react';
import { useNodeViewContext } from '@prosemirror-adapter/react';
import Dashboard from '../components/Dashboard';
import { Trash2, Database, LayoutList, LayoutGrid, CalendarDays, Kanban, Plus } from 'lucide-react';
import type { ViewMode } from '../components/Dashboard';

export const DashboardNodeView = ({ onSelectNote }: { onSelectNote: (id: number) => void }) => {
    const { node, view, getPos } = useNodeViewContext();
    const folderName = node.attrs.folder || '';
    const viewKey = `keim_view_${folderName}`;
    const [viewMode, setViewMode] = useState<ViewMode>(
        () => (localStorage.getItem(viewKey) as ViewMode | null) ?? 'table'
    );
    const [hasDateField, setHasDateField] = useState(false);
    const [hasSelectField, setHasSelectField] = useState(false);

    const switchView = (mode: ViewMode) => {
        setViewMode(mode);
        localStorage.setItem(viewKey, mode);
    };

    const handleRemove = () => {
        const pos = getPos();
        if (pos !== undefined) {
            view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
        }
    };

    const handleAddNote = async () => {
        const { db } = await import('../lib/db');
        const folders = await db.items.where({ type: 'folder', title: folderName }).toArray();
        const folder  = folders.find(f => !f.isDeleted);
        if (!folder?.id) return;
  
        const { addItem, getItemPath } = await import('../lib/db');
        const id = await addItem({ parentId: folder.id, type: 'note', title: 'New Note' }, '');
        localStorage.setItem('keim_has_user_edits', 'true');
    
        const { getStorageMode, writeNoteToVault, notePathFromTitle } = await import('../lib/vault');
        if (getStorageMode() === 'vault') {
            try {
                const allItems = await db.items.toArray();
                const parentPath = getItemPath(folder.id, allItems);
                const notePath = notePathFromTitle('New Note', parentPath);
                await writeNoteToVault(notePath, '');
            } catch (e) {
                console.warn('Could not write new note to vault immediately', e);
            }
        }
        
        const { triggerAutoSync } = await import('../lib/sync');
        triggerAutoSync();
        
        onSelectNote(id as number);
        setTimeout(() => window.dispatchEvent(new CustomEvent('keim_focus_title', { detail: id })), 150);
    };

    const VIEW_MODES: ViewMode[] = ['table', 'gallery'];
    if (hasDateField) VIEW_MODES.push('calendar');
    if (hasSelectField) VIEW_MODES.push('kanban');

    return (
        <div className="dashboard-node py-2 group">
            {/* Title bar — visible only on hover */}
            <div className="flex items-center justify-between px-1 pb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="flex items-center gap-2 text-dark-bg/40 dark:text-light-bg/35 select-none">
                    <Database size={12} className="text-indigo-400" />
                    <span className="text-[11px] font-bold uppercase tracking-widest">
                        Dashboard: {folderName}
                    </span>
                </div>

                {/* Right side: view switcher + trash */}
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleAddNote}
                        title="New Note"
                        className="w-6 h-6 flex items-center justify-center rounded-md mr-1
                                   text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300
                                   hover:bg-indigo-500/10 dark:hover:bg-indigo-400/10
                                   transition-all"
                    >
                        <Plus size={14} strokeWidth={2.5} />
                    </button>

                    {VIEW_MODES.map(mode => {
                        const Icon = mode === 'table' ? LayoutList : mode === 'gallery' ? LayoutGrid : mode === 'calendar' ? CalendarDays : Kanban;
                        const label = mode === 'table' ? 'Table' : mode === 'gallery' ? 'Gallery' : mode === 'calendar' ? 'Calendar' : 'Kanban';
                        return (
                            <button
                                key={mode}
                                onClick={() => switchView(mode)}
                                title={label}
                                className={`w-6 h-6 flex items-center justify-center rounded-md transition-all ${
                                    viewMode === mode
                                        ? 'bg-dark-bg/10 dark:bg-white/10 text-dark-bg/70 dark:text-light-bg/70'
                                        : 'text-dark-bg/25 dark:text-light-bg/20 hover:text-dark-bg/60 dark:hover:text-light-bg/60 hover:bg-dark-bg/5 dark:hover:bg-white/5'
                                }`}
                            >
                                <Icon size={13} />
                            </button>
                        );
                    })}

                    {/* Divider */}
                    <div className="w-px h-3.5 bg-black/10 dark:bg-white/10 mx-0.5" />

                    <button
                        onClick={handleRemove}
                        title="Remove dashboard"
                        className="w-6 h-6 flex items-center justify-center rounded-md
                                   text-dark-bg/25 dark:text-light-bg/20
                                   hover:text-red-500 dark:hover:text-red-400
                                   hover:bg-red-500/8 dark:hover:bg-red-400/8
                                   transition-all"
                    >
                        <Trash2 size={13} />
                    </button>
                </div>
            </div>

            <div 
                contentEditable={false}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onKeyUp={(e) => e.stopPropagation()}
                onKeyPress={(e) => e.stopPropagation()}
                onCut={(e) => e.stopPropagation()}
                onCopy={(e) => e.stopPropagation()}
                onPaste={(e) => e.stopPropagation()}
                onDragStart={(e) => e.stopPropagation()}
                onDrop={(e) => e.stopPropagation()}
                onBeforeInput={(e) => e.stopPropagation()}
            >
                <Dashboard
                    folderName={folderName}
                    onSelectNote={onSelectNote}
                    viewMode={viewMode}
                    onHasDateField={setHasDateField}
                    onHasSelectField={setHasSelectField}
                />
            </div>
            <div className="h-4 invisible" />
        </div>
    );
};

