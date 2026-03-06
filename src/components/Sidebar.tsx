import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, addItem } from '../lib/db';
import { Folder, FolderOpen, FileText, Plus, Trash2, X, Check, Settings, HardDrive, Globe, Cloud, CloudOff, RefreshCw, AlertCircle } from 'lucide-react';
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
    onSync?: () => void;
}

export default function Sidebar({ selectedNoteId, onSelectNote, isOpen, onClose, onOpenSettings, vaultName, storageMode, syncStatus = 'disconnected', onSync }: SidebarProps) {
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
                    <div className="p-4 flex items-center justify-between border-b border-light-bg dark:border-dark-bg shrink-0">
                        {/* Vault name or app name */}
                        {vaultName ? (
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-dark-bg/60 dark:text-light-bg/60 min-w-0 truncate">
                                <span className="text-indigo-500">📁</span>
                                <span className="truncate">{vaultName}</span>
                            </div>
                        ) : <div />}
                        <div className="flex gap-1 items-center shrink-0">
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

                    <div className="flex-1 overflow-y-auto py-2 scrollbar-hide">
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
                    <div className="p-2 border-t border-light-bg dark:border-dark-bg shrink-0 flex items-center gap-2">
                        {/* Settings Icon-only button */}
                        <button
                            onClick={onOpenSettings}
                            className="p-1.5 rounded-md hover:bg-light-bg dark:hover:bg-dark-bg text-dark-bg dark:text-light-bg transition-colors shrink-0"
                            title="Settings"
                        >
                            <Settings size={16} className="opacity-70" />
                        </button>

                        {/* Storage type label */}
                        <div className="flex items-center gap-1.5 text-xs text-dark-bg/50 dark:text-light-bg/50 min-w-0 flex-1">
                            {storageMode === 'vault' ? (
                                <>
                                    <HardDrive size={12} className="shrink-0" />
                                    <span className="truncate font-medium">Local Vault</span>
                                </>
                            ) : (
                                <>
                                    <Globe size={12} className="shrink-0" />
                                    <span className="truncate font-medium">Browser</span>
                                </>
                            )}
                        </div>

                        {/* Cloud sync status */}
                        <SyncStatusBadge status={syncStatus} onSync={onSync} />
                    </div>
                </div>
            </div>
        </>
    );
}

// Recursive Tree Node Component
function TreeNode({ item, selectedId, onSelect, level }: { item: any, selectedId: number | null, onSelect: (id: number) => void, level: number }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

    // Reset confirmation state when it's not the selected note or when it's "selected" but user clicks elsewhere
    // Actually, a better way is to reset it if it was open but user clicks on something else.
    // Let's use an effect to clear confirmation when selectedId changes.
    useEffect(() => {
        setIsConfirmingDelete(false);
    }, [selectedId, isOpen]);

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
        const { deleteItem } = await import('../lib/db');
        deleteItem(item.id!);
        // If we deleted the selected note, we don't know it here but App will handle if it's unmounted.
    };

    const isSelected = selectedId === item.id;
    const baseClasses = `group flex items-center justify-between py-2 pr-2 cursor-pointer select-none transition-all duration-200 border-l-2`;
    const selectedClasses = isSelected
        ? 'bg-dark-bg/10 dark:bg-light-bg/10 border-dark-bg dark:border-light-bg text-dark-bg dark:text-light-bg font-semibold'
        : 'border-transparent text-dark-bg/70 dark:text-light-bg/70 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 hover:text-dark-bg dark:hover:text-light-bg';

    return (
        <div>
            <div
                className={`${baseClasses} ${selectedClasses}`}
                style={{ paddingLeft }}
                onClick={() => {
                    if (item.type === 'folder') setIsOpen(!isOpen);
                    else onSelect(item.id!);
                }}
            >
                <div className="flex items-center gap-2 truncate">
                    {item.type === 'folder' ? (
                        isOpen ? <FolderOpen size={16} className="opacity-80 flex-shrink-0" /> : <Folder size={16} className="opacity-80 flex-shrink-0" />
                    ) : (
                        <FileText size={16} className="opacity-80 flex-shrink-0" />
                    )}
                    <span className="truncate text-sm">{item.title}</span>
                </div>

                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
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

function SyncStatusBadge({ status, onSync }: { status: SyncStatus, onSync?: () => void }) {
    const config: Record<SyncStatus, { icon: any, text: string, color: string, spin?: boolean }> = {
        idle: { icon: Cloud, text: 'Synced', color: 'text-dark-bg/40 dark:text-light-bg/40', spin: false },
        syncing: { icon: RefreshCw, text: 'Syncing...', color: 'text-indigo-500', spin: true },
        synced: { icon: Check, text: 'Success', color: 'text-emerald-500', spin: false },
        error: { icon: AlertCircle, text: 'Sync Error', color: 'text-amber-500', spin: false },
        disconnected: { icon: CloudOff, text: 'Offline', color: 'text-dark-bg/20 dark:text-light-bg/20', spin: false }
    };

    const { icon: Icon, text, color, spin } = config[status] || config.disconnected;

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                onSync?.();
            }}
            disabled={status === 'syncing'}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full bg-dark-bg/5 dark:bg-light-bg/5 hover:bg-dark-bg/10 dark:hover:bg-light-bg/10 transition-colors shrink-0 ${color}`}
            title={status === 'disconnected' ? 'Cloud sync not connected' : 'Click to sync now'}
        >
            <Icon size={12} className={spin ? 'animate-spin' : ''} />
            <span className="text-[10px] font-bold uppercase tracking-wider">{text}</span>
        </button>
    );
}
