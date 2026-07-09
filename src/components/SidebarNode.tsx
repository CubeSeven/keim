import { useState } from 'react';
import { type VaultNote, type VaultFolder, deleteNote, deleteFolder, moveNote, moveFolder, reloadTree } from '../lib/vault';
import { useAppStore } from '../store';
import { ChevronRight, ChevronDown, FileText, Folder, Trash2 } from 'lucide-react';

export interface SidebarNodeData {
    name: string;
    type: 'note' | 'folder';
    path: string;
    children: SidebarNodeData[];
}

export function buildSidebarTree(folders: VaultFolder[], notes: VaultNote[]): SidebarNodeData[] {
    const map = new Map<string, SidebarNodeData>();
    [...folders].sort((a, b) => a.path.localeCompare(b.path)).forEach(f => {
        map.set(f.path, { name: f.name, type: 'folder', path: f.path, children: [] });
    });

    const notesByParent = new Map<string, VaultNote[]>();
    notes.forEach(n => {
        const arr = notesByParent.get(n.parentPath) ?? [];
        arr.push(n);
        notesByParent.set(n.parentPath, arr);
    });

    const addChildren = (node: SidebarNodeData, parentPath: string) => {
        const childFolders = [...folders]
            .filter(f => f.parentPath === parentPath)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(f => map.get(f.path)!)
            .filter(Boolean);
        const childNotes = (notesByParent.get(parentPath) ?? [])
            .slice()
            .sort((a, b) => a.title.localeCompare(b.title))
            .map(n => ({ name: n.title, type: 'note' as const, path: n.path, children: [] as SidebarNodeData[] }));
        childFolders.forEach(cf => addChildren(cf, cf.path));
        node.children = [...childFolders, ...childNotes];
    };

    const rootFolders = [...folders].filter(f => f.parentPath === '').sort((a, b) => a.name.localeCompare(b.name)).map(f => map.get(f.path)!);
    rootFolders.forEach(f => addChildren(f, f.path));
    const rootNotes = (notesByParent.get('') ?? []).slice().sort((a, b) => a.title.localeCompare(b.title)).map(n => ({ name: n.title, type: 'note' as const, path: n.path, children: [] as SidebarNodeData[] }));
    const root = [...rootFolders, ...rootNotes];
    return root;
}

// Returns true if `ancestorCandidate` is `child` itself or one of child's ancestors.
function isDescendant(ancestorCandidate: string, child: string, tree: SidebarNodeData[]): boolean {
    const find = (nodes: SidebarNodeData[]): boolean => {
        for (const n of nodes) {
            if (n.path === child) return true;
            if (n.type === 'folder' && find(n.children)) return true;
        }
        return false;
    };
    // Walk up from child's parent chain to see if it meets ancestorCandidate
    const childNode = (() => {
        const walk = (nodes: SidebarNodeData[]): SidebarNodeData | null => {
            for (const n of nodes) {
                if (n.path === child) return n;
                if (n.type === 'folder') {
                    const r = walk(n.children);
                    if (r) return r;
                }
            }
            return null;
        };
        return walk(tree);
    })();
    if (!childNode) return false;
    // climb ancestors
    let current = childNode;
    const getParent = (path: string): SidebarNodeData | null => {
        const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        const walk = (nodes: SidebarNodeData[]): SidebarNodeData | null => {
            for (const n of nodes) {
                if (n.path === parentPath) return n;
                if (n.type === 'folder') {
                    const r = walk(n.children);
                    if (r) return r;
                }
            }
            return null;
        };
        return walk(tree);
    };
    while (current) {
        if (current.path === ancestorCandidate) return true;
        const parent = getParent(current.path);
        if (!parent) break;
        current = parent;
    }
    return false;
}

function Node({ node, level, tree }: { node: SidebarNodeData; level: number; tree: SidebarNodeData[] }) {
    const { selectedNotePath, setSelectedNotePath, setSelectedFolderPath } = useAppStore();
    const [expanded, setExpanded] = useState(true);
    const [dragOverKind, setDragOverKind] = useState<'before' | 'after' | 'inside' | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const isActive = node.type === 'note' && node.path === selectedNotePath;

    const handleSelect = () => {
        if (node.type === 'folder') {
            setExpanded(e => !e);
            setSelectedFolderPath(node.path);
        } else {
            setSelectedNotePath(node.path);
        }
    };

    const refresh = async () => {
        const { setTree } = useAppStore.getState();
        setTree(await reloadTree());
    };

    const handleDelete = async () => {
        if (!confirm(`Delete "${node.name}"${node.type === 'folder' ? ' and all its contents' : ''}?`)) return;
        try {
            if (node.type === 'note') await deleteNote(node.path);
            else await deleteFolder(node.path);
            if (isActive) setSelectedNotePath(null);
            await refresh();
        } catch (e) {
            console.error('Delete failed', e);
        }
    };

    // --- Drag & drop ---
    const handleDragStart = (e: React.DragEvent) => {
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', node.path);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => setIsDragging(true), 0);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        if (node.type === 'folder') {
            if (y < rect.height * 0.25) setDragOverKind('before');
            else if (y > rect.height * 0.75) setDragOverKind('after');
            else setDragOverKind('inside');
        } else {
            if (y < rect.height / 2) setDragOverKind('before');
            else setDragOverKind('after');
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        const dropKind = dragOverKind;
        setDragOverKind(null);
        const draggedPath = e.dataTransfer.getData('text/plain');
        if (!draggedPath || draggedPath === node.path) return;

        const fullTree = tree;

        // Preload node metadata from current tree
        const findNode = (path: string, nodes: SidebarNodeData[] = fullTree): SidebarNodeData | null => {
            for (const n of nodes) {
                if (n.path === path) return n;
                if (n.type === 'folder') {
                    const r = findNode(path, n.children);
                    if (r) return r;
                }
            }
            return null;
        };
        const dragged = findNode(draggedPath);
        if (!dragged) return;

        // Disallow dropping a folder into its own descendant (loop)
        if (dragged.type === 'folder' && isDescendant(draggedPath, node.path, fullTree)) return;

        let targetParentPath = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
        if (dropKind === 'inside' && node.type === 'folder') {
            targetParentPath = node.path;
        }

        try {
            if (dragged.type === 'note') {
                const newPath = await moveNote(draggedPath, targetParentPath);
                await refresh();
                if (dropKind === 'inside') setExpanded(true);
                if (newPath) setSelectedNotePath(newPath);
            } else {
                await moveFolder(draggedPath, targetParentPath);
                await refresh();
                if (dropKind === 'inside') setExpanded(true);
            }
        } catch (err) {
            console.error('Move failed', err);
        }
    };

    const handleDragEnd = (e: React.DragEvent) => {
        e.stopPropagation();
        setIsDragging(false);
        setDragOverKind(null);
    };

    let rowClasses = isActive
        ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
        : 'text-dark-bg/80 dark:text-light-bg/80 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5';
    if (dragOverKind === 'inside') rowClasses += ' ring-1 ring-indigo-500/40 bg-indigo-500/5 z-10';
    if (isDragging) rowClasses += ' opacity-40';

    const paddingLeft = `${level * 14 + 8}px`;

    return (
        <div>
            <div
                className={`group relative flex items-center gap-1.5 pr-2 py-1.5 rounded-lg cursor-pointer transition-colors ${rowClasses}`}
                style={{ paddingLeft }}
                onClick={handleSelect}
                draggable
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={(e) => { e.stopPropagation(); setDragOverKind(null); }}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
            >
                {dragOverKind === 'before' && <div className="absolute -top-[1.5px] left-2 right-2 h-[3px] bg-indigo-500/60 rounded-full z-20 pointer-events-none" />}
                {dragOverKind === 'after' && <div className="absolute -bottom-[1.5px] left-2 right-2 h-[3px] bg-indigo-500/60 rounded-full z-20 pointer-events-none" />}

                {node.type === 'folder' ? (
                    <span className="shrink-0 text-dark-bg/40 dark:text-light-bg/40">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                ) : <span className="w-[14px] shrink-0" />}

                {node.type === 'folder' ? <Folder size={15} className="shrink-0 opacity-70" /> : <FileText size={15} className="shrink-0 opacity-70" />}

                <span className="flex-1 truncate text-sm select-none">{node.name}</span>

                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={e => { e.stopPropagation(); handleDelete(); }} className="p-1 rounded hover:bg-red-500/10 text-red-500" title="Delete">
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>

            {node.type === 'folder' && expanded && (
                <div>
                    {node.children.map(child => (
                        <Node key={child.path} node={child} level={level + 1} tree={tree} />
                    ))}
                </div>
            )}
        </div>
    );
}

export default Node;
