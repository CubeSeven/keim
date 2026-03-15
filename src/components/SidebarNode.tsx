import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ENABLE_SMART_PROPS } from '../constants';
import { db, type NoteItem } from '../lib/db';
import { NoteService } from '../lib/NoteService';
import { useAppStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Folder, FolderOpen, FileText, Plus, Trash2,
    Database, Edit2, MoreVertical
} from 'lucide-react';

interface SidebarNodeProps {
    item: NoteItem & { children: Array<NoteItem> };
    level: number;
    onAddNote?: (parentId: number) => void;
    onAddFolder?: (parentId: number) => void;
    onDeleteItem?: (id: number) => void;
}

export default function SidebarNode({ item, level, onAddNote, onAddFolder, onDeleteItem }: SidebarNodeProps) {
    const { selectedNoteId, setSelectedNoteId, setSidebarOpen, setSelectedFolderId } = useAppStore();
    const [isOpen, setIsOpen] = useState(false);

    const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);

    const isSmartFolder = useLiveQuery(
        () => item.type === 'folder' && ENABLE_SMART_PROPS ? db.smartSchemas.where({ folderId: item.id }).count().then(c => c > 0) : false, 
        [item.id, item.type]
    );

    useEffect(() => {
        const handleClickOutside = () => setContextMenu(null);
        if (contextMenu) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [contextMenu]);

    // Auto-expand if the selected note is a child of this folder
    useEffect(() => {
        if (item.type === 'folder' && selectedNoteId) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const hasSelectedDescendant = (node: any): boolean => {
                if (node.id === selectedNoteId) return true;
                return node.children?.some(hasSelectedDescendant) || false;
            };
            if (hasSelectedDescendant(item)) {
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setIsOpen(true);
            }
        }
    }, [selectedNoteId, item]);

    // Renaming state
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(item.title);
    const inputRef = useRef<HTMLInputElement>(null);



    useEffect(() => {
        const handleRename = (e: CustomEvent) => {
            if (e.detail === item.id) setIsRenaming(true);
        };
        window.addEventListener('keim_rename_node', handleRename as EventListener);
        return () => window.removeEventListener('keim_rename_node', handleRename as EventListener);
    }, [item.id]);

    const handleDelete = useCallback(async () => {
        await NoteService.removeItem(item);
        onDeleteItem?.(item.id!);
    }, [item, onDeleteItem]);



    useEffect(() => {
        if (isRenaming && inputRef.current) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setRenameValue(item.title);
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isRenaming, item.title]);

    const handleAddChild = (e: React.MouseEvent, type: 'folder' | 'note') => {
        e.stopPropagation();
        setIsOpen(true);
        if (type === 'note') onAddNote?.(item.id!);
        else onAddFolder?.(item.id!);
    };

    const handleRenameSubmit = async () => {
        setIsRenaming(false);
        const newTitle = renameValue.trim();
        if (newTitle && newTitle !== item.title) {
            await NoteService.renameItem(item, newTitle);
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

    // Drag and Drop Logic
    const [dragOverKind, setDragOverKind] = useState<'before' | 'after' | 'inside' | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleDragStart = (e: React.DragEvent) => {
        if (item.id === undefined) return;
        e.stopPropagation();
        e.dataTransfer.setData('text/plain', item.id.toString());
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => setIsDragging(true), 0);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
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

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        const dropKind = dragOverKind;
        setDragOverKind(null);

        const draggedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (Number.isNaN(draggedId) || draggedId === item.id) return;

        const allItems = await db.items.toArray();
        const draggedNode = allItems.find(i => i.id === draggedId);
        if (!draggedNode) return;

        // Prevent dropping parent into its own descendant to avoid loops
        if (draggedNode.type === 'folder') {
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
            .sort((a, b) => (a.order ?? a.updated_at ?? 0) - (b.order ?? b.updated_at ?? 0));

        let newOrder = Date.now();
        if (dropKind === 'inside' || siblings.length === 0) {
            if (siblings.length > 0) newOrder = (siblings[siblings.length - 1].order ?? siblings[siblings.length - 1].updated_at) + 1000;
        } else {
            const itemIndex = siblings.findIndex(i => i.id === item.id);
            if (itemIndex !== -1) {
                if (dropKind === 'before') {
                    if (itemIndex === 0) newOrder = (siblings[0].order ?? siblings[0].updated_at) - 1000;
                    else newOrder = ((siblings[itemIndex - 1].order ?? 0) + (siblings[itemIndex].order ?? 0)) / 2;
                } else if (dropKind === 'after') {
                    if (itemIndex === siblings.length - 1) newOrder = (siblings[itemIndex].order ?? 0) + 1000;
                    else newOrder = ((siblings[itemIndex].order ?? 0) + (siblings[itemIndex + 1].order ?? 0)) / 2;
                }
            } 
        }

        await NoteService.moveItem(draggedNode, targetParentId, newOrder);
        if (dropKind === 'inside') setIsOpen(true);
    };

    const isSelected = selectedNoteId === item.id;
    const paddingLeft = `${(level * 12) + 16}px`;

    let selectedClasses = isSelected
        ? 'bg-white/50 dark:bg-white/10 text-dark-bg dark:text-light-bg font-semibold ring-1 ring-black/5 dark:ring-white/10 shadow-sm'
        : 'text-dark-bg/70 dark:text-light-bg/70 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 hover:text-dark-bg dark:hover:text-light-bg';

    if (dragOverKind === 'inside') selectedClasses += ' ring-1 ring-dark-bg/20 dark:ring-light-bg/20 bg-dark-bg/5 dark:bg-light-bg/5 z-10';
    if (isDragging) selectedClasses += ' opacity-40 grayscale';

    return (
        <div>
            <div
                className={`relative group flex items-center justify-between py-2 pr-2 mx-2 rounded-lg cursor-pointer select-none transition-all duration-200 ${selectedClasses}`}
                style={{ paddingLeft }}
                onClick={(e: React.MouseEvent) => { // Added React.MouseEvent type to 'e'
                    if (isRenaming) return;
                    if (contextMenu) { setContextMenu(null); e.stopPropagation(); return; }
                    if (item.type === 'folder') {
                        setIsOpen(!isOpen);
                        setSelectedFolderId(item.id!);
                    } else {
                        setSelectedNoteId(item.id!);
                        setSelectedFolderId(item.parentId);
                        if (window.innerWidth < 768) setSidebarOpen(false);
                    }
                }}
                onContextMenu={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: Math.min(e.clientY, window.innerHeight - 200) });
                }}
                onContextMenuCapture={(e) => e.preventDefault()}
                onDoubleClick={(e) => { e.stopPropagation(); setIsRenaming(true); }}
                draggable={!isRenaming}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={(e) => { e.stopPropagation(); setDragOverKind(null); }}
                onDrop={handleDrop}
                onDragEnd={(e) => { e.stopPropagation(); setIsDragging(false); setDragOverKind(null); }}
            >
                {dragOverKind === 'before' && <div className="absolute -top-[1.5px] right-2 h-[3px] bg-dark-bg/40 dark:bg-light-bg/40 rounded-full z-20 pointer-events-none" style={{ left: paddingLeft }} />}
                {dragOverKind === 'after' && <div className="absolute -bottom-[1.5px] right-2 h-[3px] bg-dark-bg/40 dark:bg-light-bg/40 rounded-full z-20 pointer-events-none" style={{ left: paddingLeft }} />}

                <div className="flex items-center gap-2 truncate flex-1 min-w-0 pointer-events-none">
                    {item.icon ? <span className="text-base leading-none flex-shrink-0">{item.icon}</span> 
                    : item.type === 'folder' ? (
                        <div className="relative flex-shrink-0">
                            <motion.div
                                key={isOpen ? 'open' : 'closed'}
                                initial={{ scale: 0.7, opacity: 0 }}
                                animate={{ scale: 1, opacity: 0.8 }}
                                transition={{ duration: 0.15 }}
                            >
                                {isSmartFolder ? <Database size={16} /> : (isOpen ? <FolderOpen size={16} /> : <Folder size={16} />)}
                            </motion.div>
                        </div>
                    ) : <FileText size={16} className="opacity-80 flex-shrink-0" />}

                    {isRenaming ? (
                        <input
                            ref={inputRef}
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={handleRenameSubmit}
                            onKeyDown={handleKeyDown}
                            onClick={e => e.stopPropagation()}
                            className="bg-dark-bg/10 dark:bg-light-bg/10 text-dark-bg dark:text-light-bg px-1 py-0.5 rounded text-sm outline-none w-full min-w-[50px] pointer-events-auto"
                        />
                    ) : <span className="truncate text-sm" title={item.title}>{item.title}</span>}
                </div>

                {!isRenaming && (
                    <button
                        onClick={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setContextMenu({ x: Math.min(rect.right - 200, window.innerWidth - 220), y: Math.min(rect.top + 20, window.innerHeight - 200) });
                        }}
                        className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-dark-bg/50 dark:text-light-bg/50 transition-opacity ml-2 shrink-0 md:opacity-0 group-hover:opacity-100 opacity-100 pointer-events-auto"
                    >
                        <MoreVertical size={16} />
                    </button>
                )}
            </div>

            {item.type === 'folder' && (
                <AnimatePresence initial={false}>
                    {isOpen && (
                        <motion.div
                            key="children"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                            style={{ overflow: 'hidden' }}
                        >
                            <AnimatePresence initial={false}>
                                {item.children.map((child) => (
                                    <motion.div
                                        key={child.id}
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -8, height: 0 }}
                                        transition={{ duration: 0.18, ease: 'easeOut' }}
                                    >
                                        <SidebarNode
                                            item={child as NoteItem & { children: Array<NoteItem> }}
                                            level={level + 1}
                                            onAddNote={onAddNote}
                                            onAddFolder={onAddFolder}
                                            onDeleteItem={onDeleteItem}
                                        />
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </motion.div>
                    )}
                </AnimatePresence>
            )}

            <AnimatePresence>
                {contextMenu && (
                    <motion.div
                        key="context-menu"
                        initial={{ opacity: 0, scale: 0.92, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.92, y: -4 }}
                        transition={{ duration: 0.12, ease: 'easeOut' }}
                        className="fixed z-[100] bg-light-bg/85 dark:bg-[#1a1a1f]/80 backdrop-blur-xl border border-black/5 dark:border-white/10 shadow-2xl rounded-xl py-1.5 w-52"
                        style={{ top: contextMenu.y, left: contextMenu.x, transformOrigin: 'top left' }}
                        onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                    >
                        {item.type === 'folder' && (
                            <>
                                <button className="w-full text-left px-3 py-2 hover:bg-dark-bg/5 flex items-center gap-2.5" 
                                    onClick={(e) => { setContextMenu(null); handleAddChild(e, 'note'); }}>
                                    <Plus size={14} className="opacity-70" /> Add Note
                                </button>
                                <button className="w-full text-left px-3 py-2 hover:bg-dark-bg/5 flex items-center gap-2.5" 
                                    onClick={(e) => { setContextMenu(null); handleAddChild(e, 'folder'); }}>
                                    <Folder size={14} className="opacity-70" /> Add Folder
                                </button>
                                {ENABLE_SMART_PROPS && (
                                    <button className="w-full text-left px-3 py-2 hover:bg-dark-bg/5 flex items-center gap-2.5"
                                        onClick={() => {
                                            setContextMenu(null);
                                            useAppStore.getState().setSmartPopupState({ isOpen: true, folderId: item.id, folderTitle: item.title });
                                        }}>
                                        <Database size={14} className="opacity-70" /> {isSmartFolder ? 'Edit Properties' : 'Make Smart'}
                                    </button>
                                )}
                                <div className="h-px bg-light-border dark:bg-dark-border my-1" />
                            </>
                        )}
                        <button className="w-full text-left px-3 py-2 hover:bg-dark-bg/5 flex items-center gap-2.5" 
                            onClick={(e) => { e.stopPropagation(); setContextMenu(null); setIsRenaming(true); }}>
                            <Edit2 size={14} className="opacity-70" /> Rename
                        </button>
                        <button className="w-full text-left px-3 py-2 hover:bg-red-500/10 flex items-center gap-2.5 text-red-600" 
                            onClick={(e) => { e.stopPropagation(); setContextMenu(null); handleDelete(); }}>
                            <Trash2 size={14} /> Delete
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
