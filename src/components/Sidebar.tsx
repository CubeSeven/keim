import { useState, useMemo, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type NoteItem } from '../lib/db';
import { triggerAutoSync } from '../lib/sync';
import {
    Folder, FolderOpen, FileText, Plus, Trash2, X, Check,
    Settings, HardDrive, Globe, Cloud, CloudOff, AlertCircle, Search,
    Tag, ChevronRight, ChevronDown, Lock, ArrowRight
} from 'lucide-react';
import type { SyncStatus } from '../App';

interface SidebarProps {
    selectedNoteId: number | null;
    onSelectNote: (id: number) => void;
    isOpen: boolean;
    onClose: () => void;
    onOpenSettings: () => void;
    storageMode?: 'vault' | 'indexeddb' | 'unset';
    syncStatus: SyncStatus;
    lastSyncTime: number | null;
    onSync?: () => void;
    onAddNote?: (parentId: number) => void;
    onAddFolder?: (parentId: number) => void;
    isVaultLocked?: boolean;
    onUnlockVault?: () => void;
    onDeleteItem?: (id: number) => void;
}

export default function Sidebar({
    selectedNoteId, onSelectNote, isOpen, onClose, onOpenSettings,
    storageMode, syncStatus, lastSyncTime, onSync, onAddNote, onAddFolder,
    isVaultLocked, onUnlockVault, onDeleteItem
}: SidebarProps) {
    const items = useLiveQuery(() => db.items.filter(item => !item.isDeleted).toArray());

    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [isTagsOpen, setIsTagsOpen] = useState(true);

    const uniqueTags = useMemo(() => {
        if (!items) return [];
        const tags = new Set<string>();
        items.forEach(item => {
            if (item.tags) {
                item.tags.forEach(t => tags.add(t));
            }
        });
        return Array.from(tags).sort();
    }, [items]);

    const tree = useMemo(() => {
        if (!items) return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const itemMap = new Map<number, any>();
        items.forEach(item => itemMap.set(item.id!, { ...item, children: [] }));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const roots: any[] = [];
        itemMap.forEach(item => {
            if (item.parentId === 0) {
                roots.push(item);
            } else {
                const parent = itemMap.get(item.parentId);
                if (parent && parent.type === 'folder') {
                    parent.children.push(item);
                } else {
                    roots.push(item);
                }
            }
        });

        if (selectedTag) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const filterTree = (nodes: any[]): any[] => {
                return nodes.map(n => {
                    if (n.type === 'note') {
                        if (n.tags && n.tags.includes(selectedTag)) return n;
                        return null;
                    }
                    if (n.type === 'folder' && n.children) {
                        const filteredChildren = filterTree(n.children);
                        if (filteredChildren.length > 0) {
                            return { ...n, children: filteredChildren };
                        }
                    }
                    return null;
                }).filter(Boolean);
            };
            const filteredRoots = filterTree(roots);
            roots.splice(0, roots.length, ...filteredRoots);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sortTree = (nodes: any[]) => {
            nodes.sort((a, b) => {
                const orderA = a.order ?? a.updated_at ?? 0;
                const orderB = b.order ?? b.updated_at ?? 0;
                if (orderA !== orderB) return orderA - orderB;
                if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
                return a.title.localeCompare(b.title);
            });
            nodes.forEach(n => {
                if (n.children && n.children.length > 0) sortTree(n.children);
            });
        };
        sortTree(roots);
        return roots;
    }, [items, selectedTag]);

    const handleAddAtRoot = (type: 'folder' | 'note') => {
        if (type === 'note') onAddNote?.(0);
        else onAddFolder?.(0);
    };

    const headerIconBtnClass = "p-2 md:p-1 hover:bg-light-bg dark:hover:bg-dark-bg rounded text-dark-bg dark:text-light-bg transition-colors";

    return (
        <>
            {/* Mobile Backdrop overlay (only visible < 768px) */}
            <div
                className={`md:hidden fixed inset-0 bg-dark-bg/50 backdrop-blur-sm z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Sidebar container - Universal Sliding Drawer */}
            <div
                className={`
                    fixed inset-y-0 left-0 z-50 h-full w-64 bg-light-ui dark:bg-dark-ui border-r border-light-bg dark:border-dark-bg flex flex-col
                    transition-transform duration-300 ease-in-out
                    transform ${isOpen ? 'translate-x-0 shadow-2xl md:shadow-none' : '-translate-x-full'}
                `}
            >
                <div className="flex flex-col h-full">
                    <div
                        className="p-4 flex items-center justify-end shrink-0"
                        style={{
                            paddingTop: 'calc(1rem + var(--spacing-safe-top, 0px))',
                            paddingLeft: 'calc(1rem + var(--spacing-safe-left, 0px))'
                        }}
                    >
                        <div className="flex gap-1 items-center shrink-0">
                            <button
                                onClick={() => {
                                    // Manually dispatch the keydown event to trigger cmdk
                                    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', altKey: true }));
                                }}
                                className={headerIconBtnClass}
                                title="Search Notes (Alt+K)"
                            >
                                <Search size={16} />
                            </button>
                            <button
                                onClick={() => handleAddAtRoot('note')}
                                className={headerIconBtnClass}
                                title="Add Note"
                            >
                                <Plus size={16} />
                            </button>
                            <button
                                onClick={() => handleAddAtRoot('folder')}
                                className={headerIconBtnClass}
                                title="Add Folder"
                            >
                                <Folder size={16} />
                            </button>
                        </div>
                    </div>

                    <div
                        className="flex-1 overflow-y-auto py-2 scrollbar-hide"
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={async (e) => {
                            // Only trigger root drop if dropped directly in empty space
                            if ((e.target as HTMLElement).closest('[draggable]')) return;
                            e.preventDefault();
                            const draggedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
                            if (Number.isNaN(draggedId)) return;
                            const { updateItem, db: appDb, getItemPath } = await import('../lib/db');
                            const { getStorageMode, deleteFromVault, notePathFromTitle, writeNoteToVault } = await import('../lib/vault');

                            const allItems = await appDb.items.toArray();
                            
                            // ── Physical Vault File Move ──
                            const oldNote = allItems.find(i => i.id === draggedId);
                            if (oldNote && oldNote.parentId !== 0 && getStorageMode() === 'vault') {
                                if (oldNote.type === 'note') {
                                    const oldParentPath = getItemPath(oldNote.parentId, allItems);
                                    const oldPath = notePathFromTitle(oldNote.title, oldParentPath);
                                    const newPath = notePathFromTitle(oldNote.title, ''); // Root has empty parentPath
                                    if (oldPath !== newPath) {
                                        try {
                                            const contentObj = await appDb.contents.get(draggedId);
                                            await deleteFromVault(oldPath);
                                            await writeNoteToVault(newPath, contentObj?.content || '');
                                        } catch (err) {
                                            console.warn('Physical move in vault failed during root drop', err);
                                        }
                                    }
                                }
                            }

                            const roots = allItems.filter(i => i.parentId === 0 && !i.isDeleted && i.id !== draggedId);
                            roots.sort((a, b) => {
                                const orderA = a.order ?? a.updated_at ?? 0;
                                const orderB = b.order ?? b.updated_at ?? 0;
                                return orderA - orderB;
                            });
                            let newOrder = Date.now();
                            if (roots.length > 0) {
                                newOrder = (roots[roots.length - 1].order ?? roots[roots.length - 1].updated_at) + 1000;
                            }

                            await updateItem(draggedId, { parentId: 0, order: newOrder });
                            triggerAutoSync();
                        }}
                    >
                        {tree.map(node => (
                            <TreeNode
                                key={node.id}
                                item={node}
                                selectedId={selectedNoteId}
                                onSelect={onSelectNote}
                                level={0}
                                onAddNote={onAddNote}
                                onAddFolder={onAddFolder}
                                onDeleteItem={onDeleteItem}
                            />
                        ))}

                        {/* --- Tags Archive Section --- */}
                        {uniqueTags.length > 0 && (
                            <div className="mt-4 pt-2">
                                <div
                                    className="flex items-center justify-between px-4 py-1.5 cursor-pointer hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 text-dark-bg/70 dark:text-light-bg/70 transition-colors select-none"
                                    onClick={() => setIsTagsOpen(!isTagsOpen)}
                                >
                                    <div className="flex items-center gap-1.5 font-medium text-xs uppercase tracking-wider">
                                        {isTagsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        <Tag size={12} className="opacity-70" />
                                        Tags
                                    </div>
                                    {selectedTag && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setSelectedTag(null); }}
                                            className="text-xs flex items-center gap-1 bg-dark-bg/10 dark:bg-light-bg/10 px-1.5 rounded hover:bg-dark-bg/20 dark:hover:bg-light-bg/20 font-medium"
                                        >
                                            <X size={10} /> Clear
                                        </button>
                                    )}
                                </div>
                                {isTagsOpen && (
                                    <div className="flex flex-col mt-1 mb-2">
                                        {uniqueTags.map(tag => {
                                            const isSelected = selectedTag === tag;
                                            const tagCount = items?.filter(i => i.tags && i.tags.includes(tag)).length || 0;
                                            return (
                                                <div
                                                    key={tag}
                                                    onClick={() => setSelectedTag(isSelected ? null : tag)}
                                                    className={`
                                                        px-8 py-1.5 cursor-pointer text-sm flex items-center justify-between group
                                                        ${isSelected
                                                            ? 'bg-dark-bg/10 dark:bg-light-bg/10 text-dark-bg dark:text-light-bg font-medium'
                                                            : 'text-dark-bg/70 dark:text-light-bg/70 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 hover:text-dark-bg dark:hover:text-light-bg'
                                                        }
                                                    `}
                                                    title={`${tagCount} notes`}
                                                >
                                                    <span className="truncate">#{tag}</span>
                                                    <span className={`text-xs opacity-0 group-hover:opacity-100 transition-opacity ${isSelected ? 'opacity-50' : ''}`}>
                                                        {tagCount}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Bottom Status Bar */}
                    <div
                        className="p-2 shrink-0 flex items-center justify-between"
                        style={{
                            paddingBottom: 'calc(0.5rem + var(--spacing-safe-bottom, 0px))',
                            paddingLeft: 'calc(0.5rem + var(--spacing-safe-left, 0px))'
                        }}
                    >
                        <div className="flex items-center gap-2">
                            {/* Settings Icon-only button */}
                            <button
                                onClick={onOpenSettings}
                                className="p-1.5 rounded-md hover:bg-light-bg dark:hover:bg-dark-bg text-dark-bg dark:text-light-bg transition-colors shrink-0"
                                title="Settings"
                            >
                                <Settings size={16} className="opacity-70" />
                            </button>
                            {/* Storage type icon */}
                            <div
                                className="flex items-center justify-center p-1.5 rounded-md text-dark-bg/60 dark:text-light-bg/60"
                                title={storageMode === 'vault' ? 'Local Vault' : 'Browser Storage'}
                            >
                                {storageMode === 'vault' ? <HardDrive size={16} /> : <Globe size={16} />}
                            </div>
                        </div>

                        {/* Cloud sync status */}
                        <SyncStatusBadge status={syncStatus} lastSyncTime={lastSyncTime} onSync={onSync} />
                    </div>
                    {isVaultLocked && (
                        <button
                            onClick={onUnlockVault}
                            className="w-full flex items-center justify-between p-3 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/20 group text-left"
                        >
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-white/20 rounded-md">
                                    <Lock size={14} className="group-hover:animate-bounce" />
                                </div>
                                <div>
                                    <span className="text-[11px] font-bold uppercase tracking-wider block leading-none">Vault Locked</span>
                                    <span className="text-[10px] opacity-90 leading-none">Tap to Grant Access</span>
                                </div>
                            </div>
                            <ArrowRight size={14} className="opacity-70 group-hover:translate-x-1 transition-transform" />
                        </button>
                    )}
                </div>
            </div>
        </>
    );
}

// Recursive Tree Node Component
interface TreeNodeProps {
    item: NoteItem & { children: Array<NoteItem> };
    selectedId: number | null;
    onSelect: (id: number) => void;
    level: number;
    onAddNote?: (parentId: number) => void;
    onAddFolder?: (parentId: number) => void;
    onDeleteItem?: (id: number) => void;
}

function TreeNode({ item, selectedId, onSelect, level, onAddNote, onAddFolder, onDeleteItem }: TreeNodeProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

    // Auto-expand if the selected note is a child of this folder
    useEffect(() => {
        if (item.type === 'folder' && selectedId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const hasSelectedDescendant = (node: any): boolean => {
                if (node.id === selectedId) return true;
                return node.children?.some(hasSelectedDescendant) || false;
            };
            if (hasSelectedDescendant(item)) {
                setIsOpen(true);
            }
        }
    }, [selectedId, item]);

    // Renaming state
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(item.title);
    const inputRef = useRef<HTMLInputElement>(null);

    // Reset confirmation state when it's not the selected note or when it's "selected" but user clicks elsewhere
    // Actually, a better way is to reset it if it was open but user clicks on something else.
    // Let's use an effect to clear confirmation when selectedId changes.
    useEffect(() => {
        setIsConfirmingDelete(false);
    }, [selectedId, isOpen]);

    useEffect(() => {
        const handleRename = (e: CustomEvent) => {
            if (e.detail === item.id) {
                setIsRenaming(true);
            }
        };
        window.addEventListener('keim_rename_node', handleRename as EventListener);
        return () => window.removeEventListener('keim_rename_node', handleRename as EventListener);
    }, [item.id]);

    useEffect(() => {
        if (isRenaming && inputRef.current) {
            setRenameValue(item.title);
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isRenaming, item.title]);

    const paddingLeft = `${(level * 12) + 16}px`;
    const actionBtnClass = "hover:scale-110 p-1.5 md:p-0.5 rounded transition-transform opacity-100 md:opacity-70 hover:opacity-100 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5";

    const handleAddChild = (e: React.MouseEvent, type: 'folder' | 'note') => {
        e.stopPropagation();
        setIsOpen(true);
        if (type === 'note') onAddNote?.(item.id!);
        else onAddFolder?.(item.id!);
    };

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsConfirmingDelete(true);
    };

    const cancelDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsConfirmingDelete(false);
    };

    const confirmDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsConfirmingDelete(false);
        const { deleteItem, db: appDb, getItemPath } = await import('../lib/db');
        const { removeFromSearchIndex } = await import('../lib/search');

        // ── Step 1: Physical vault delete BEFORE soft-delete in Dexie ──────────
        // We must resolve the vault path while the item is still present and
        // non-deleted in the DB. On Android, also check QueryPermission first —
        // if the vault is locked the delete silently succeeds in Dexie but we
        // skip the disk op rather than throwing a confusing NotAllowedError.
        const { getStorageMode, deleteFromVault, notePathFromTitle, getVaultHandle } = await import('../lib/vault');
        if (getStorageMode() === 'vault') {
            const allItems = await appDb.items.toArray();
            const parentPath = getItemPath(item.parentId, allItems);
            const vaultPath = item.type === 'note'
                ? notePathFromTitle(item.title, parentPath)
                : (parentPath ? `${parentPath}/${item.title}` : item.title);

            const handle = getVaultHandle();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const permission = handle ? await (handle as any).queryPermission({ mode: 'readwrite' }) : 'prompt';
            if (permission === 'granted') {
                try {
                    await deleteFromVault(vaultPath);
                } catch (err) {
                    console.warn('Could not remove from vault (may already be deleted):', err);
                }
            } else {
                // Vault is locked on Android — the .md file will be cleaned up
                // automatically the next time the vault is unlocked and reloaded.
                console.info(`Vault locked: skipping physical delete of "${vaultPath}". Will be removed on next vault access.`);
            }
        }

        // ── Step 2: Soft-delete in Dexie (tombstone for cloud sync) ─────────────
        await deleteItem(item.id!);
        if (item.type === 'note') {
            await removeFromSearchIndex(item.id!);
        }
        localStorage.setItem('keim_has_user_edits', 'true');

        // Push the deletion tombstone to Dropbox immediately
        triggerAutoSync();

        onDeleteItem?.(item.id!);
    };

    const handleRenameSubmit = async () => {
        setIsRenaming(false);
        const newTitle = renameValue.trim();
        if (newTitle && newTitle !== item.title) {
            const { updateItem, db, getItemPath } = await import('../lib/db');
            const { updateSearchIndex } = await import('../lib/search');
            const { triggerAutoSync } = await import('../lib/sync');
            const { getStorageMode, deleteFromVault, notePathFromTitle, writeNoteToVault, moveVaultFolder } = await import('../lib/vault');

            const allItems = await db.items.toArray();
            const parentPath = getItemPath(item.parentId, allItems);

            // 1. UPDATE DB FIRST. This ensures that any background sync triggered by
            // this action, or any live query, reads the NEW title, preventing 
            // "New Folder" from being resurrected by the reconciler.
            await updateItem(item.id!, { title: newTitle, updated_at: Date.now() });

            // 2. Update physical vault if enabled
            if (getStorageMode() === 'vault') {
                try {
                    if (item.type === 'note') {
                        const oldPath = notePathFromTitle(item.title, parentPath);
                        const newPath = notePathFromTitle(newTitle, parentPath);
                        let textContent = '';
                        const contentObj = await db.contents.get(item.id!);
                        if (contentObj) textContent = contentObj.content;

                        await deleteFromVault(oldPath);
                        await writeNoteToVault(newPath, textContent);
                    } else if (item.type === 'folder') {
                        const oldFolderPath = getItemPath(item.id!, allItems); // Uses old title from allItems snapshot
                        const newFolderPath = parentPath ? `${parentPath}/${newTitle}` : newTitle;
                        
                        const allContents = await db.contents.toArray();
                        // Re-fetch allItems so moveVaultFolder has the new DB state, 
                        // though it mostly uses it for building descendant paths
                        const freshItems = await db.items.toArray(); 
                        await moveVaultFolder(oldFolderPath, newFolderPath, freshItems, allContents, getItemPath);
                    }
                } catch (e) {
                    console.error('Failed to rename in vault', e);
                }
            }

            // 3. Update Search Index
            if (item.type === 'note') {
                const contentObj = await db.contents.get(item.id!);
                if (contentObj) {
                    const newPath = getItemPath(item.parentId, await db.items.toArray());
                    updateSearchIndex(item.id!, newTitle, contentObj.content, item.parentId, newPath, item.icon, item.tags);
                }
            }

            // 4. Trigger Sync
            localStorage.setItem('keim_has_user_edits', 'true');
            triggerAutoSync();
        } else {
            setRenameValue(item.title);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleRenameSubmit();
        if (e.key === 'Escape') {
            setIsRenaming(false);
            setRenameValue(item.title);
        }
    };

    // --- Drag and Drop Logic --- //
    const [dragOverKind, setDragOverKind] = useState<'before' | 'after' | 'inside' | null>(null);

    const handleDragStart = (e: React.DragEvent) => {
        if (item.id === undefined) return;
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', item.id.toString());
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;

        if (item.type === 'folder') {
            if (y < rect.height * 0.25) setDragOverKind('before');
            else if (y > rect.height * 0.75) setDragOverKind('after');
            else setDragOverKind('inside');
        } else {
            if (y < rect.height / 2) setDragOverKind('before');
            else setDragOverKind('after');
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.stopPropagation();
        setDragOverKind(null);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const dropKind = dragOverKind;
        setDragOverKind(null);

        const draggedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (Number.isNaN(draggedId) || draggedId === item.id) return;

        const { updateItem, db: appDb } = await import('../lib/db');

        const allItems = await appDb.items.toArray();
        const draggedNode = allItems.find(i => i.id === draggedId);

        // Prevent dropping parent into its own descendant to avoid loops
        if (draggedNode && draggedNode.type === 'folder') {
            let currentParent = item.id;
            while (currentParent !== 0) {
                if (currentParent === draggedId) return; // Disallowed
                const parentNode = allItems.find(i => i.id === currentParent);
                if (!parentNode) break;
                currentParent = parentNode.parentId;
            }
        }

        let targetParentId = item.parentId;
        if (dropKind === 'inside' && item.type === 'folder') {
            targetParentId = item.id!;
        }

        const siblings = allItems
            .filter(i => i.parentId === targetParentId && !i.isDeleted && i.id !== draggedId)
            .sort((a, b) => {
                const orderA = a.order ?? a.updated_at ?? 0;
                const orderB = b.order ?? b.updated_at ?? 0;
                return orderA - orderB;
            });

        let newOrder = Date.now();
        if (dropKind === 'inside') {
            if (siblings.length > 0) {
                newOrder = (siblings[siblings.length - 1].order ?? siblings[siblings.length - 1].updated_at) + 1000;
            }
        } else {
            const itemIndex = siblings.findIndex(i => i.id === item.id);
            if (itemIndex !== -1) {
                if (dropKind === 'before') {
                    if (itemIndex === 0) {
                        newOrder = (siblings[0].order ?? siblings[0].updated_at) - 1000;
                    } else {
                        const prev = siblings[itemIndex - 1];
                        const oPrev = prev.order ?? prev.updated_at ?? 0;
                        const oCurr = siblings[itemIndex].order ?? siblings[itemIndex].updated_at ?? 0;
                        newOrder = (oPrev + oCurr) / 2;
                    }
                } else if (dropKind === 'after') {
                    if (itemIndex === siblings.length - 1) {
                        newOrder = (siblings[itemIndex].order ?? siblings[itemIndex].updated_at ?? 0) + 1000;
                    } else {
                        const next = siblings[itemIndex + 1];
                        const oCurr = siblings[itemIndex].order ?? siblings[itemIndex].updated_at ?? 0;
                        const oNext = next.order ?? next.updated_at ?? 0;
                        newOrder = (oCurr + oNext) / 2;
                    }
                }
            } else if (siblings.length > 0) {
                // Fallback
                newOrder = (siblings[siblings.length - 1].order ?? siblings[siblings.length - 1].updated_at) + 1000;
            }
        }

        const oldNote = allItems.find(i => i.id === draggedId);
        if (oldNote && oldNote.parentId !== targetParentId) {
            const { getStorageMode, deleteFromVault, notePathFromTitle, writeNoteToVault, moveVaultFolder } = await import('../lib/vault');
            const { getItemPath } = await import('../lib/db');
            if (getStorageMode() === 'vault') {
                if (oldNote.type === 'note') {
                    const oldParentPath = getItemPath(oldNote.parentId, allItems);
                    const newParentPath = getItemPath(targetParentId, allItems);
                    const oldPath = notePathFromTitle(oldNote.title, oldParentPath);
                    const newPath = notePathFromTitle(oldNote.title, newParentPath);
                    if (oldPath !== newPath) {
                        try {
                            const contentObj = await appDb.contents.get(draggedId);
                            await deleteFromVault(oldPath);
                            await writeNoteToVault(newPath, contentObj?.content || '');
                        } catch (err) {
                            console.warn('Physical move in vault failed', err);
                        }
                    }
                } else if (oldNote.type === 'folder') {
                    const oldFolderPath = getItemPath(oldNote.id!, allItems);
                    // Compute what new path WOULD be: target parent path + old folder title
                    const targetParentPath = getItemPath(targetParentId, allItems);
                    const newFolderPath = targetParentPath ? `${targetParentPath}/${oldNote.title}` : oldNote.title;
                    
                    if (oldFolderPath !== newFolderPath) {
                        try {
                            const allContents = await appDb.contents.toArray();
                            await moveVaultFolder(oldFolderPath, newFolderPath, allItems, allContents, getItemPath);
                        } catch (err) {
                            console.warn('Physical folder move in vault failed', err);
                        }
                    }
                }
            }
        }

        await updateItem(draggedId, {
            parentId: targetParentId,
            order: newOrder
        });
        triggerAutoSync();

        if (dropKind === 'inside') setIsOpen(true);
    };

    const isSelected = selectedId === item.id;
    const baseClasses = `group flex items-center justify-between py-2 pr-2 cursor-pointer select-none transition-all duration-200 border-l-2`;
    let selectedClasses = isSelected
        ? 'bg-dark-bg/10 dark:bg-light-bg/10 border-dark-bg dark:border-light-bg text-dark-bg dark:text-light-bg font-semibold'
        : 'border-transparent text-dark-bg/70 dark:text-light-bg/70 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 hover:text-dark-bg dark:hover:text-light-bg';

    if (dragOverKind === 'inside') {
        selectedClasses += ' bg-indigo-500/10 border-indigo-500 ring-2 ring-indigo-500/20';
    } else if (dragOverKind === 'before') {
        selectedClasses += ' border-t-2 border-t-indigo-500';
    } else if (dragOverKind === 'after') {
        selectedClasses += ' border-b-2 border-b-indigo-500';
    }

    return (
        <div>
            <div
                className={`${baseClasses} ${selectedClasses}`}
                style={{ paddingLeft }}
                onClick={() => {
                    if (isRenaming) return;
                    if (item.type === 'folder') setIsOpen(!isOpen);
                    else onSelect(item.id!);
                }}
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    setIsRenaming(true);
                }}
                draggable={!isRenaming}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <div className="flex items-center gap-2 truncate flex-1 min-w-0 pointer-events-none">
                    {item.icon ? (
                        <span className="text-base leading-none flex-shrink-0">{item.icon}</span>
                    ) : item.type === 'folder' ? (
                        isOpen ? <FolderOpen size={16} className="opacity-80 flex-shrink-0" /> : <Folder size={16} className="opacity-80 flex-shrink-0" />
                    ) : (
                        <FileText size={16} className="opacity-80 flex-shrink-0" />
                    )}

                    {isRenaming ? (
                        <input
                            ref={inputRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={handleRenameSubmit}
                            onKeyDown={handleKeyDown}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-dark-bg/10 dark:bg-light-bg/10 text-dark-bg dark:text-light-bg px-1 py-0.5 rounded text-sm outline-none w-full min-w-[50px] pointer-events-auto"
                        />
                    ) : (
                        <span className="truncate text-sm" title={item.title}>{item.title}</span>
                    )}
                </div>

                {!isRenaming && (
                    <div className="flex items-center gap-2 md:gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity ml-2 shrink-0 pointer-events-auto">
                        {isConfirmingDelete ? (
                            <div className="flex items-center gap-1 bg-red-500/10 px-1 rounded">
                                <button onClick={confirmDelete} className="text-red-600 dark:text-red-400 p-1.5 hover:scale-110" title="Confirm Delete"><Check size={14} /></button>
                                <button onClick={cancelDelete} className="text-dark-bg dark:text-light-bg opacity-70 p-1.5 hover:scale-110" title="Cancel"><X size={14} /></button>
                            </div>
                        ) : (
                            <>
                                {item.type === 'folder' && (
                                    <>
                                        <button onClick={(e) => handleAddChild(e, 'note')} className={actionBtnClass} title="Add Note"><Plus size={14} /></button>
                                        <button onClick={(e) => handleAddChild(e, 'folder')} className={actionBtnClass} title="Add Subfolder"><Folder size={14} /></button>
                                    </>
                                )}
                                <button onClick={handleDeleteClick} className={`${actionBtnClass} hover:text-red-500 hover:bg-red-500/10 dark:hover:bg-red-500/10`} title="Delete"><Trash2 size={14} /></button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {item.type === 'folder' && isOpen && (
                <div>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {item.children.map((child: any) => <TreeNode
                        key={child.id}
                        item={child}
                        selectedId={selectedId}
                        onSelect={onSelect}
                        level={level + 1}
                        onAddNote={onAddNote}
                        onAddFolder={onAddFolder}
                        onDeleteItem={onDeleteItem}
                    />
                    )}
                </div>
            )}
        </div>
    );
}

function SyncStatusBadge({ status, lastSyncTime, onSync }: { status: SyncStatus, lastSyncTime?: number | null, onSync?: () => void }) {
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => {
        if (status === 'synced') {
            const timer = setTimeout(() => setShowSuccess(true), 0);
            const hideTimer = setTimeout(() => setShowSuccess(false), 3000);
            return () => {
                clearTimeout(timer);
                clearTimeout(hideTimer);
            };
        }
    }, [status, lastSyncTime]);

    const timeString = lastSyncTime
        ? new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

    let content;
    let colorClass;

    if (status === 'disconnected') {
        colorClass = 'text-dark-bg/30 dark:text-light-bg/30';
        content = (
            <CloudOff size={16} />
        );
    } else if (status === 'error') {
        colorClass = 'text-amber-500';
        content = (
            <>
                <AlertCircle size={16} />
                <span className="text-[10px] font-medium tracking-wide leading-none">Error</span>
            </>
        );
    } else if (status === 'syncing') {
        colorClass = 'text-[#F44E2C]';
        content = (
            <div className="flex items-center justify-center gap-[3px] px-1 h-3">
                <div className="w-1.5 h-1.5 bg-[#F44E2C] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-1.5 h-1.5 bg-[#F44E2C] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-1.5 h-1.5 bg-[#F44E2C] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
        );
    } else if (status === 'synced' && showSuccess) {
        colorClass = 'text-emerald-500';
        content = (
            <>
                <Check size={16} strokeWidth={3} />
                <span className="text-[10px] font-bold uppercase tracking-wider leading-none">Synced</span>
            </>
        );
    } else {
        // idle or (synced and not showing success/time showing)
        colorClass = 'text-dark-bg/60 dark:text-light-bg/60';
        content = (
            <>
                {status === 'synced' ? <Check size={16} strokeWidth={2} className="opacity-70" /> : <Cloud size={16} className="opacity-70" />}
                {timeString && <span className="text-[10px] font-medium tracking-wide leading-none opacity-80">{timeString}</span>}
            </>
        );
    }

    let tooltip = status === 'disconnected' ? 'Cloud sync not connected' : 'Click to sync now';
    if (status !== 'disconnected' && lastSyncTime && status !== 'syncing') {
        tooltip = `Last synced: ${timeString}. Click to sync now`;
    } else if (status === 'syncing') {
        tooltip = 'Syncing...';
    }

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                if (status !== 'syncing') onSync?.();
            }}
            disabled={status === 'syncing'}
            className={`flex items-center h-7 px-2 gap-1.5 rounded-md hover:bg-dark-bg/10 dark:hover:bg-light-bg/10 transition-colors shrink-0 ${colorClass}`}
            title={tooltip}
        >
            {content}
        </button>
    );
}
