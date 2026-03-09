import { useState, useMemo, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, addItem, type NoteItem } from '../lib/db';
import { triggerAutoSync } from '../lib/sync';
import {
    Folder, FolderOpen, FileText, Plus, Trash2, X, Check,
    Settings, HardDrive, Globe, Cloud, CloudOff, AlertCircle, Search
} from 'lucide-react';
import type { SyncStatus } from '../App';

interface SidebarProps {
    selectedNoteId: number | null;
    onSelectNote: (id: number) => void;
    isOpen: boolean;
    onClose: () => void;
    onOpenSettings: () => void;
    vaultName?: string;
    storageMode?: 'vault' | 'indexeddb' | 'unset';
    syncStatus?: SyncStatus;
    lastSyncTime?: number | null;
    onSync?: () => void;
}

export default function Sidebar({ selectedNoteId, onSelectNote, isOpen, onClose, onOpenSettings, storageMode, syncStatus = 'disconnected', lastSyncTime, onSync }: SidebarProps) {
    const items = useLiveQuery(() => db.items.filter(item => !item.isDeleted).toArray());

    const tree = useMemo(() => {
        if (!items) return [];
        const itemMap = new Map<number, any>();
        items.forEach(item => itemMap.set(item.id!, { ...item, children: [] }));

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
    }, [items]);

    const handleAddAtRoot = async (type: 'folder' | 'note') => {
        const title = type === 'folder' ? 'New Folder' : 'New Note';
        await addItem({
            parentId: 0,
            type,
            title
        }, '');
        localStorage.setItem('keim_has_user_edits', 'true');
    };

    const headerIconBtnClass = "p-1 hover:bg-light-bg dark:hover:bg-dark-bg rounded text-dark-bg dark:text-light-bg transition-colors";

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
                    <div className="p-4 flex items-center justify-end border-b border-light-bg dark:border-dark-bg shrink-0">
                        <div className="flex gap-1 items-center shrink-0">
                            <button
                                onClick={() => {
                                    // Manually dispatch the keydown event to trigger cmdk
                                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
                                }}
                                className={headerIconBtnClass}
                                title="Search Notes (Ctrl+K)"
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
                            const { updateItem, db: appDb } = await import('../lib/db');

                            const allItems = await appDb.items.toArray();
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
                        }}
                    >
                        {tree.map(node => (
                            <TreeNode
                                key={node.id}
                                item={node}
                                selectedId={selectedNoteId}
                                onSelect={onSelectNote}
                                level={0}
                            />
                        ))}
                    </div>

                    {/* Bottom Status Bar */}
                    <div className="p-2 border-t border-light-bg dark:border-dark-bg shrink-0 flex items-center justify-between">
                        <div className="flex items-center gap-1">
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
}

function TreeNode({ item, selectedId, onSelect, level }: TreeNodeProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

    // Auto-expand if the selected note is a child of this folder
    useEffect(() => {
        if (item.type === 'folder' && selectedId) {
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
        if (isRenaming && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isRenaming]);

    const paddingLeft = `${(level * 12) + 16}px`;
    const actionBtnClass = "hover:scale-110 transition-transform opacity-70 hover:opacity-100";

    const handleAddChild = async (e: React.MouseEvent, type: 'folder' | 'note') => {
        e.stopPropagation();
        const title = type === 'folder' ? 'New Folder' : 'New Note';
        await addItem({
            parentId: item.id!,
            type,
            title
        }, '');
        localStorage.setItem('keim_has_user_edits', 'true');
        setIsOpen(true);
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
        const { deleteItem, db: appDb, getFullPath } = await import('../lib/db');
        const { removeFromSearchIndex } = await import('../lib/search');

        await deleteItem(item.id!);
        if (item.type === 'note') {
            await removeFromSearchIndex(item.id!);
        }
        localStorage.setItem('keim_has_user_edits', 'true');

        // In vault mode, physically remove the file/folder from disk so it doesn't
        // reappear on next vault reload. The soft-delete alone is not enough.
        const { getStorageMode, deleteFromVault, notePathFromTitle } = await import('../lib/vault');
        if (getStorageMode() === 'vault') {
            const allItems = await appDb.items.toArray();
            const parentPath = getFullPath(item.parentId, allItems);
            const vaultPath = item.type === 'note'
                ? notePathFromTitle(item.title, parentPath)
                : (parentPath ? `${parentPath}/${item.title}` : item.title);
            try {
                await deleteFromVault(vaultPath);
            } catch (err) {
                console.warn('Could not remove from vault (may already be deleted):', err);
            }
        }

        // Push the deletion tombstone to Dropbox immediately
        triggerAutoSync();
    };

    const handleRenameSubmit = async () => {
        setIsRenaming(false);
        const newTitle = renameValue.trim();
        if (newTitle && newTitle !== item.title) {
            const { updateItem, db, getFullPath } = await import('../lib/db');
            const { updateSearchIndex } = await import('../lib/search');
            const { triggerAutoSync } = await import('../lib/sync');
            const { getStorageMode, deleteFromVault, notePathFromTitle, writeNoteToVault } = await import('../lib/vault');

            const allItems = await db.items.toArray();
            const parentPath = getFullPath(item.parentId, allItems);

            // If vault mode, rename the file by reading old, deleting old, writing new
            if (getStorageMode() === 'vault') {
                const oldPath = notePathFromTitle(item.title, parentPath);
                const newPath = notePathFromTitle(newTitle, parentPath);

                try {
                    let textContent = '';
                    if (item.type === 'note') {
                        const contentObj = await db.contents.get(item.id!);
                        if (contentObj) textContent = contentObj.content;
                    }

                    if (item.type === 'note') {
                        await deleteFromVault(oldPath);
                        await writeNoteToVault(newPath, textContent);
                    } else {
                        // For folders, we'd need to rename the directory in the vault,
                        // but File System Access API doesn't support direct rename.
                        // Since folders contain children, a full recursive move is complex.
                        // For now we just update DB. A true vault folder move requires
                        // recursive copying which is out of scope for a simple rename fix.
                        console.warn('Vault folder rename not fully supported by FS API yet');
                    }
                } catch (e) {
                    console.error('Failed to rename in vault', e);
                }
            }

            // Update Database
            await updateItem(item.id!, { title: newTitle, updated_at: Date.now() });

            // Update Search Index if it's a note
            if (item.type === 'note') {
                const contentObj = await db.contents.get(item.id!);
                if (contentObj) {
                    updateSearchIndex(item.id!, newTitle, contentObj.content, item.parentId);
                }
            }

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

        await updateItem(draggedId, {
            parentId: targetParentId,
            order: newOrder
        });

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
                    {item.type === 'folder' ? (
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
                    <div className="flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity ml-2 shrink-0 pointer-events-auto">
                        {isConfirmingDelete ? (
                            <div className="flex items-center gap-1 bg-red-500/10 px-1 rounded">
                                <button onClick={confirmDelete} className="text-red-600 dark:text-red-400 p-0.5 hover:scale-110" title="Confirm Delete"><Check size={14} /></button>
                                <button onClick={cancelDelete} className="text-dark-bg dark:text-light-bg opacity-70 p-0.5 hover:scale-110" title="Cancel"><X size={14} /></button>
                            </div>
                        ) : (
                            <>
                                {item.type === 'folder' && (
                                    <>
                                        <button onClick={(e) => handleAddChild(e, 'note')} className={actionBtnClass} title="Add Note"><Plus size={14} /></button>
                                        <button onClick={(e) => handleAddChild(e, 'folder')} className={actionBtnClass} title="Add Subfolder"><Folder size={14} /></button>
                                    </>
                                )}
                                <button onClick={handleDeleteClick} className={`${actionBtnClass} hover:text-red-500`} title="Delete"><Trash2 size={14} /></button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {item.type === 'folder' && isOpen && (
                <div>
                    {item.children.map((child: any) => (
                        <TreeNode
                            key={child.id}
                            item={child}
                            selectedId={selectedId}
                            onSelect={onSelect}
                            level={level + 1}
                        />
                    ))}
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
                <AlertCircle size={14} />
                <span className="text-[10px] font-medium tracking-wide leading-none mt-0.5">Error</span>
            </>
        );
    } else if (status === 'syncing') {
        colorClass = 'text-indigo-500';
        content = (
            <div className="flex items-center justify-center gap-[3px] px-1 h-3">
                <div className="w-1.5 h-1.5 bg-indigo-500 dark:bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-1.5 h-1.5 bg-indigo-500 dark:bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-1.5 h-1.5 bg-indigo-500 dark:bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
        );
    } else if (status === 'synced' && showSuccess) {
        colorClass = 'text-emerald-500';
        content = (
            <>
                <Check size={14} strokeWidth={3} />
                <span className="text-[10px] font-bold uppercase tracking-wider leading-none mt-0.5">Synced</span>
            </>
        );
    } else {
        // idle or (synced and not showing success/time showing)
        colorClass = 'text-dark-bg/60 dark:text-light-bg/60';
        content = (
            <>
                {status === 'synced' ? <Check size={14} strokeWidth={2} className="opacity-70" /> : <Cloud size={14} className="opacity-70" />}
                {timeString && <span className="text-[10px] font-medium tracking-wide leading-none mt-0.5 opacity-80">{timeString}</span>}
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
