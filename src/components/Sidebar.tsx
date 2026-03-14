import { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { triggerAutoSync } from '../lib/sync';
import { NoteService } from '../lib/NoteService';
import { useAppStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import SidebarNode from './SidebarNode';
import { Settings, HardDrive, Globe, Cloud, CloudOff, AlertCircle, Tag, ChevronRight, ChevronDown, Lock, ArrowRight, Check, X } from 'lucide-react';
import type { SyncStatus } from '../App';
import { mirage } from 'ldrs';
mirage.register();

interface SidebarProps {
    onOpenSettings: () => void;
    onAddNote: (parentId?: number) => void;
    onAddFolder: (parentId?: number) => void;
    onUnlockVault: () => Promise<boolean>;
    onDeleteItem?: (id: number) => void;
    
    // Kept for backward compat with App.tsx which passes these props
    selectedNoteId?: number | null;
    onSelectNote?: (id: number | null) => void;
    isOpen?: boolean;
    onClose?: () => void;
    storageMode?: string;
    syncStatus?: SyncStatus;
    lastSyncTime?: number | null;
    onSync?: () => void;
    isVaultLocked?: boolean;
}

export default function Sidebar({ onOpenSettings, onAddNote, onAddFolder, onUnlockVault, onDeleteItem }: SidebarProps) {
    const { isSidebarOpen, setSidebarOpen, setSelectedNoteId, syncStatus, lastSyncTime, isVaultLocked } = useAppStore();
    const items = useLiveQuery(() => db.items.filter(item => !item.isDeleted).toArray());

    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [isTagsOpen, setIsTagsOpen] = useState(true);

    const storageMode = 'idx' as string; // Handled via NoteService now, but keeping prop for now to avoid complete UI break

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

    return (
        <>
            <AnimatePresence>
                {isSidebarOpen && (
                    <motion.div
                        key="sidebar-overlay"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="md:hidden fixed inset-0 bg-dark-bg/50 backdrop-blur-sm z-40"
                        onClick={() => setSidebarOpen(false)}
                        aria-hidden="true"
                    />
                )}
            </AnimatePresence>

            <aside
                className="fixed inset-y-0 left-0 z-50 h-full w-64 bg-light-ui/70 dark:bg-dark-ui/70 backdrop-blur-xl border-r border-black/5 dark:border-white/5 flex flex-col shadow-2xl md:shadow-none transition-transform duration-300 ease-in-out"
                style={{ transform: isSidebarOpen ? 'translateX(0)' : 'translateX(-100%)' }}
            >
                <div className="flex flex-col h-full">
                    <div
                        className="shrink-0 h-14 md:h-16 flex items-center px-4 gap-3"
                        style={{ paddingTop: 'var(--spacing-safe-top, 0px)', paddingLeft: 'var(--spacing-safe-left, 0px)' }}
                    ></div>

                    <div
                        className="flex-1 overflow-y-auto py-2 scrollbar-hide flex flex-col"
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                        onDrop={async (e) => {
                            if ((e.target as HTMLElement).closest('[draggable]')) return;
                            e.preventDefault();
                            const draggedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
                            if (Number.isNaN(draggedId)) return;
                            
                            const draggedNode = (await db.items.toArray()).find(i => i.id === draggedId);
                            if (!draggedNode) return;

                            const roots = (await db.items.toArray()).filter(i => i.parentId === 0 && !i.isDeleted && i.id !== draggedId);
                            roots.sort((a, b) => (a.order ?? a.updated_at ?? 0) - (b.order ?? b.updated_at ?? 0));
                            let newOrder = Date.now();
                            if (roots.length > 0) newOrder = (roots[roots.length - 1].order ?? roots[roots.length - 1].updated_at) + 1000;

                            await NoteService.moveItem(draggedNode, 0, newOrder);
                        }}
                    >
                        <div className="flex-1 min-h-full cursor-default" onClick={(e) => { if (e.target === e.currentTarget) setSelectedNoteId(null); }}>
                            <AnimatePresence initial={false}>
                                {tree.map(node => (
                                    <motion.div
                                        key={node.id}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -10, height: 0 }}
                                        transition={{ duration: 0.2, ease: 'easeOut' }}
                                    >
                                        <SidebarNode
                                            item={node}
                                            level={0}
                                            onAddNote={onAddNote}
                                            onAddFolder={onAddFolder}
                                            onDeleteItem={onDeleteItem}
                                        />
                                    </motion.div>
                                ))}
                            </AnimatePresence>

                        {/* --- Tags Archive Section --- */}
                        {uniqueTags.length > 0 && (
                            <div className="mt-4 pt-2">
                                <div className="flex items-center justify-between px-4 py-1.5 cursor-pointer hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 text-dark-bg/70 dark:text-light-bg/70 transition-colors select-none" onClick={() => setIsTagsOpen(!isTagsOpen)}>
                                    <div className="flex items-center gap-1.5 font-medium text-xs uppercase tracking-wider">
                                        {isTagsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} <Tag size={12} className="opacity-70" /> Tags
                                    </div>
                                    {selectedTag && (
                                        <button onClick={(e) => { e.stopPropagation(); setSelectedTag(null); }} className="text-xs flex items-center gap-1 bg-dark-bg/10 dark:bg-light-bg/10 px-1.5 rounded hover:bg-dark-bg/20 font-medium">
                                            <X size={10} /> Clear
                                        </button>
                                    )}
                                </div>
                                <AnimatePresence initial={false}>
                                    {isTagsOpen && (
                                        <motion.div
                                            key="tag-list"
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                                            style={{ overflow: 'hidden' }}
                                        >
                                            <div className="flex flex-col mt-1 mb-2">
                                                {uniqueTags.map((tag, i) => {
                                                    const isSelected = selectedTag === tag;
                                                    const tagCount = items?.filter(item => item.tags && item.tags.includes(tag)).length || 0;
                                                    return (
                                                        <motion.div
                                                            key={`${tag}-${i}`}
                                                            initial={{ opacity: 0, x: -6 }}
                                                            animate={{ opacity: 1, x: 0 }}
                                                            transition={{ duration: 0.15, delay: i * 0.03 }}
                                                            onClick={() => setSelectedTag(isSelected ? null : tag)}
                                                            className={`relative mx-2 px-3 py-1.5 cursor-pointer text-sm flex items-center justify-between group rounded-md transition-colors ${isSelected ? 'text-dark-bg font-semibold' : 'text-dark-bg/60 hover:bg-dark-bg/5'}`}
                                                            title={`${tagCount} notes`}
                                                        >
                                                            {isSelected && (
                                                                <motion.div
                                                                    layoutId="tag-active-bg"
                                                                    className="absolute inset-0 rounded-md bg-white/50 ring-1 shadow-sm"
                                                                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                                                />
                                                            )}
                                                            <span className="truncate relative z-10">#{tag}</span>
                                                            <span className={`text-xs opacity-0 group-hover:opacity-100 transition-opacity relative z-10 ${isSelected ? 'opacity-50' : ''}`}>{tagCount}</span>
                                                        </motion.div>
                                                    );
                                                })}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}
                        </div>
                    </div>

                    <div className="mx-2 mb-2 p-1.5 shrink-0 flex items-center justify-between bg-white/50 dark:bg-white/10 backdrop-blur-md rounded-xl border border-black/5 dark:border-white/5 shadow-sm ring-1 ring-black/5 dark:ring-white/10" style={{ marginBottom: 'calc(0.5rem + var(--spacing-safe-bottom, 0px))' }}>
                        <div className="flex items-center gap-1">
                            <button onClick={onOpenSettings} className="p-1.5 rounded-lg hover:bg-dark-bg/10 dark:hover:bg-light-bg/10 text-dark-bg/70 dark:text-light-bg/70 transition-colors shrink-0" title="Settings">
                                <Settings size={16} strokeWidth={1.5} />
                            </button>
                            <div className="flex items-center justify-center p-1.5 rounded-lg text-dark-bg/40 dark:text-light-bg/40">
                                {storageMode === 'vault' ? <HardDrive size={16} strokeWidth={1.5} /> : <Globe size={16} strokeWidth={1.5} />}
                            </div>
                        </div>

                        <SyncStatusBadge status={syncStatus} lastSyncTime={lastSyncTime} onSync={() => triggerAutoSync()} />
                    </div>
                    {isVaultLocked && (
                        <button onClick={onUnlockVault} className="w-full flex items-center justify-between p-3 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/20 group text-left">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-white/20 rounded-md"><Lock size={14} className="group-hover:animate-bounce" /></div>
                                <div><span className="text-[11px] font-bold uppercase tracking-wider block leading-none">Vault Locked</span><span className="text-[10px] opacity-90 leading-none">Tap to Grant Access</span></div>
                            </div>
                            <ArrowRight size={14} className="opacity-70 group-hover:translate-x-1 transition-transform" />
                        </button>
                    )}
                </div>
            </aside>
        </>
    );
}

function SyncStatusBadge({ status, lastSyncTime, onSync }: { status: SyncStatus, lastSyncTime?: number | null, onSync?: () => void }) {
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => {
        if (status === 'synced') {
            const timer = setTimeout(() => setShowSuccess(true), 0);
            const hideTimer = setTimeout(() => setShowSuccess(false), 3000);
            return () => { clearTimeout(timer); clearTimeout(hideTimer); };
        }
    }, [status, lastSyncTime]);

    const timeString = lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    let content;
    let colorClass;

    if (status === 'disconnected') { colorClass = 'text-dark-bg/30'; content = <CloudOff size={16} strokeWidth={1.5} />; }
    else if (status === 'error') { colorClass = 'text-amber-500'; content = <><AlertCircle size={16} strokeWidth={1.5} /><span className="text-[10px] font-medium tracking-wide leading-none">Error</span></>; }
    else if (status === 'syncing') { colorClass = 'text-[#F44E2C]'; content = <div className="flex items-center justify-center px-1 h-4"><l-mirage size="22" speed="2.5" color="currentColor" /></div>; }
    else if (status === 'synced' && showSuccess) { colorClass = 'text-emerald-500'; content = <Check size={18} strokeWidth={2.5} className="mx-0.5" />; }
    else { colorClass = 'text-dark-bg/60'; content = <>{status === 'synced' ? <Check size={18} strokeWidth={2.5} className="opacity-70" /> : <Cloud size={16} strokeWidth={1.5} className="opacity-70" />}{timeString && <span className="text-[10px] font-medium opacity-80">{timeString}</span>}</>; }

    return (
        <button onClick={(e) => { e.stopPropagation(); if (status !== 'syncing') onSync?.(); }} disabled={status === 'syncing'} className={`flex items-center h-[28px] md:h-[26px] px-2 gap-1.5 rounded-lg hover:bg-dark-bg/10 shrink-0 ${colorClass}`}>
            {content}
        </button>
    );
}
