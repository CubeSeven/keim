import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getFullPath } from '../lib/db';
import { triggerAutoSync } from '../lib/sync';
import { getStorageMode, writeNoteToVault, notePathFromTitle } from '../lib/vault';
import { updateSearchIndex } from '../lib/search';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { Crepe } from '@milkdown/crepe';
import EmojiPicker from 'emoji-picker-react';
import { SmilePlus, X, Tag, Plus, Lock, ArrowRight } from 'lucide-react';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import 'katex/dist/katex.min.css';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

interface EditorProps {
    noteId: number;
    isVaultLocked?: boolean;
    onUnlockVault?: () => Promise<boolean>;
}

interface CrepeBodyProps {
    content: string;
    noteId: number;
    onSave: (markdown: string) => void;
}

function CrepeBody({ content, noteId, onSave }: CrepeBodyProps) {
    useEditor(
        (root) => {
            const crepe = new Crepe({
                root,
                defaultValue: content,
            });

            // Milkdown fires markdownUpdated once on initial mount with the default value,
            // even before the user types. Skipping that first event prevents a phantom
            // save → triggerAutoSync → unnecessary sync cascade on every editor mount.
            let isFirstUpdate = true;

            crepe.editor
                .config((ctx) => {
                    ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
                        if (isFirstUpdate) {
                            isFirstUpdate = false;
                            return;
                        }
                        onSave(markdown);
                    });
                })
                .use(listener);

            return crepe;
        },
        [noteId]
    );

    return <Milkdown />;
}

export default function Editor({ noteId, isVaultLocked, onUnlockVault }: EditorProps) {
    const note = useLiveQuery(() => db.items.get(noteId), [noteId]);
    const noteContent = useLiveQuery(() => db.contents.get(noteId), [noteId]);
    const [title, setTitle] = useState('');
    const saveTimeoutRef = useRef<number | null>(null);
    const [syncRevision, setSyncRevision] = useState(0);

    const [showIconPicker, setShowIconPicker] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
                setShowIconPicker(false);
            }
        };
        if (showIconPicker) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showIconPicker]);

    const handleIconChange = async (icon: string | null) => {
        await db.items.update(noteId, { icon: icon === null ? undefined : icon, updated_at: Date.now() });
        localStorage.setItem('keim_has_user_edits', 'true');
        triggerAutoSync();
        setShowIconPicker(false);
    };

    const [showTagInput, setShowTagInput] = useState(false);
    const [tagInputValue, setTagInputValue] = useState('');
    const [uniqueTags, setUniqueTags] = useState<string[]>([]);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const tagInputRef = useRef<HTMLInputElement>(null);
    const tagContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (showTagInput) {
            db.items.toArray().then(items => {
                const tags = new Set<string>();
                items.forEach(i => {
                    if (i.tags) i.tags.forEach(t => tags.add(t));
                });
                setUniqueTags(Array.from(tags));
            });
        }
    }, [showTagInput]);

    const suggestedTags = useMemo(() => {
        const cleanVal = tagInputValue.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
        if (cleanVal.length > 0) {
            return uniqueTags.filter(t => t.startsWith(cleanVal) && t !== cleanVal).slice(0, 5);
        }
        return [];
    }, [tagInputValue, uniqueTags]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (tagContainerRef.current && !tagContainerRef.current.contains(e.target as Node)) {
                setShowTagInput(false);
            }
        };
        if (showTagInput) {
            document.addEventListener('mousedown', handleClickOutside);
            setTimeout(() => tagInputRef.current?.focus(), 0);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showTagInput]);

    const handleTagSubmit = async () => {
        const newTag = tagInputValue.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
        if (newTag && note) {
            const currentTags = note.tags || [];
            if (!currentTags.includes(newTag)) {
                const newTags = [...currentTags, newTag];
                await db.items.update(noteId, { tags: newTags, updated_at: Date.now() });
                if (noteContent) {
                    updateSearchIndex(noteId, note.title, noteContent.content, note.parentId, newTags);
                }
                localStorage.setItem('keim_has_user_edits', 'true');
                triggerAutoSync();
            }
        }
        setTagInputValue('');
        setShowTagInput(false);
    };

    const handleAddTag = async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedSuggestionIndex(prev => Math.min(prev + 1, suggestedTags.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedSuggestionIndex(prev => Math.max(prev - 1, 0));
        } else if ((e.key === 'Tab' || e.key === 'Enter') && suggestedTags.length > 0 && suggestedTags[selectedSuggestionIndex]) {
            e.preventDefault();
            setTagInputValue(suggestedTags[selectedSuggestionIndex]);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            await handleTagSubmit();
        } else if (e.key === 'Escape') {
            setShowTagInput(false);
        }
    };

    const handleRemoveTag = async (tagToRemove: string) => {
        if (note) {
            const currentTags = note.tags || [];
            const newTags = currentTags.filter(t => t !== tagToRemove);
            await db.items.update(noteId, { tags: newTags, updated_at: Date.now() });
            if (noteContent) {
                updateSearchIndex(noteId, note.title, noteContent.content, note.parentId, newTags);
            }
            localStorage.setItem('keim_has_user_edits', 'true');
            triggerAutoSync();
        }
    };

    // Re-mount editor when sync downloads new content for THIS specific note
    useEffect(() => {
        const handleSyncComplete = ((e: CustomEvent) => {
            const downloadedIds = e.detail?.downloadedIds as number[] | undefined;
            if (!downloadedIds || downloadedIds.includes(noteId)) {
                setSyncRevision(r => r + 1);
            }
        }) as EventListener;
        window.addEventListener('keim_sync_complete', handleSyncComplete);
        return () => window.removeEventListener('keim_sync_complete', handleSyncComplete);
    }, [noteId]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (note) {
                setTitle(note.title);
            } else {
                setTitle('');
            }
        }, 0);
        return () => clearTimeout(timer);
    }, [note]);

    const debouncedSaveContent = useCallback(
        (markdown: string) => {
            if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = window.setTimeout(async () => {
                await db.contents.put({ id: noteId, content: markdown });
                await db.items.update(noteId, { updated_at: Date.now() });
                if (note) {
                    updateSearchIndex(noteId, note.title, markdown, note.parentId, note.tags);
                }
                localStorage.setItem('keim_has_user_edits', 'true'); // Document touched Let Cloud know
                // Write to vault if active
                if (note && getStorageMode() === 'vault') {
                    const allItems = await db.items.toArray();
                    const parentPath = getFullPath(noteId, allItems);
                    const path = notePathFromTitle(note.title, parentPath);
                    writeNoteToVault(path, markdown).catch(console.warn);
                }
                triggerAutoSync();
            }, 500);
        },
        [noteId, note]
    );

    // Title editing debouncer
    const titleTimeoutRef = useRef<number | null>(null);

    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTitle = e.target.value;
        setTitle(newTitle);

        if (titleTimeoutRef.current) window.clearTimeout(titleTimeoutRef.current);
        titleTimeoutRef.current = window.setTimeout(async () => {
            const oldNote = await db.items.get(noteId);
            const contentObj = await db.contents.get(noteId);

            if (oldNote && oldNote.title !== newTitle && getStorageMode() === 'vault') {
                try {
                    const allItems = await db.items.toArray();
                    const parentPath = getFullPath(oldNote.parentId, allItems);
                    const oldPath = notePathFromTitle(oldNote.title, parentPath);
                    const newPath = notePathFromTitle(newTitle, parentPath);

                    if (oldPath !== newPath) {
                        const { deleteFromVault } = await import('../lib/vault');
                        await deleteFromVault(oldPath);
                        await writeNoteToVault(newPath, contentObj?.content || '');
                    }
                } catch (err) {
                    console.error('Failed to rename vault file from Editor', err);
                }
            }

            await db.items.update(noteId, { title: newTitle, updated_at: Date.now() });
            if (note && contentObj) {
                updateSearchIndex(noteId, newTitle, contentObj.content, note.parentId, note.tags);
            }
            localStorage.setItem('keim_has_user_edits', 'true');
            triggerAutoSync();
        }, 500);
    };

    const titleInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleFocus = (e: CustomEvent) => {
            if (e.detail === noteId && titleInputRef.current) {
                titleInputRef.current.focus();
                titleInputRef.current.select();
            }
        };
        window.addEventListener('keim_focus_title', handleFocus as EventListener);
        return () => window.removeEventListener('keim_focus_title', handleFocus as EventListener);
    }, [noteId]);

    if (!note || noteContent === undefined) return null;

    return (
        /* Full-height scroll container */
        <div className="h-full overflow-y-auto">
            {/* Notion-style: centered column, comfortable max-width, generous top padding */}
            <div
                className="mx-auto w-full px-6 md:px-12 lg:px-24 pb-64"
                style={{
                    maxWidth: '720px',
                    paddingTop: 'calc(3rem + var(--spacing-safe-top, 0px))'
                }}
            >
                {/* ── Vault Locked Banner ── */}
                {isVaultLocked && (
                    <div className="mb-10 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex flex-col md:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-300">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white shrink-0 shadow-lg shadow-indigo-500/20">
                                <Lock size={18} />
                            </div>
                            <div className="text-left">
                                <h4 className="text-sm font-bold text-dark-bg dark:text-light-bg leading-tight">Vault is Locked (Read Only)</h4>
                                <p className="text-[11px] opacity-70 leading-tight">Browser security requires re-granting access to your folder.</p>
                            </div>
                        </div>
                        <button
                            onClick={onUnlockVault}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 text-white text-xs font-bold hover:bg-indigo-600 transition-all shadow-md active:scale-95 whitespace-nowrap"
                        >
                            Grant Access <ArrowRight size={14} />
                        </button>
                    </div>
                )}

                {/* ── Top Actions & Headers ── */}
                <div className="group flex flex-col items-start gap-1 mb-2">
                    {/* ── Icon Display (if set) ── */}
                    {note.icon && (
                        <div className="relative group/icon inline-block mb-2" ref={pickerRef}>
                            <div
                                className="text-6xl cursor-pointer select-none"
                                onClick={() => setShowIconPicker(!showIconPicker)}
                            >
                                {note.icon}
                            </div>
                            <button
                                onClick={() => handleIconChange(null)}
                                className="opacity-0 group-hover/icon:opacity-100 absolute -top-1.5 -right-1.5 bg-light-bg dark:bg-dark-bg text-dark-bg/50 dark:text-light-bg/50 hover:text-red-500 rounded-full p-1.5 md:p-0.5 shadow-md border border-black/5 dark:border-white/10 z-10 transition-all scale-100 md:scale-75 md:group-hover/icon:scale-100"
                            >
                                <X size={10} />
                            </button>
                            {showIconPicker && (
                                <div className="absolute z-50 top-full left-0 mt-2 shadow-xl rounded-lg border border-light-border dark:border-dark-border overflow-hidden">
                                    <EmojiPicker onEmojiClick={(e) => handleIconChange(e.emoji)} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Action Buttons ── */}
                    <div className="flex items-center gap-1 font-medium">
                        {!note.icon && (
                            <div className="relative" ref={pickerRef}>
                                <button
                                    onClick={() => setShowIconPicker(!showIconPicker)}
                                    className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center gap-1.5 text-dark-bg/40 dark:text-light-bg/40 hover:text-dark-bg/60 dark:hover:text-light-bg/60 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 rounded px-3 py-2 md:px-2 md:py-1 text-sm font-medium"
                                >
                                    <SmilePlus size={16} />
                                    Add icon
                                </button>
                                {showIconPicker && (
                                    <div className="absolute z-50 top-full left-0 mt-2 shadow-xl rounded-lg border border-light-border dark:border-dark-border overflow-hidden">
                                        <EmojiPicker onEmojiClick={(e) => handleIconChange(e.emoji)} />
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="relative" ref={tagContainerRef}>
                            <button
                                onClick={() => setShowTagInput(!showTagInput)}
                                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center gap-1.5 text-dark-bg/40 dark:text-light-bg/40 hover:text-dark-bg/60 dark:hover:text-light-bg/60 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 rounded px-3 py-2 md:px-2 md:py-1 text-sm font-medium"
                            >
                                <Tag size={16} />
                                Add tag
                            </button>

                            {showTagInput && (
                                <div className="absolute z-50 top-full left-0 mt-1 bg-light-bg/85 dark:bg-[#1a1a1f]/80 backdrop-blur-xl shadow-2xl rounded-xl border border-black/5 dark:border-white/10 p-1">
                                    <div className="flex items-center px-2 py-1 gap-1.5 relative">
                                        <span className="text-dark-bg/40 dark:text-light-bg/40 font-medium">#</span>
                                        <input
                                            ref={tagInputRef}
                                            type="text"
                                            value={tagInputValue}
                                            onChange={(e) => setTagInputValue(e.target.value)}
                                            onKeyDown={handleAddTag}
                                            placeholder="tag name..."
                                            className="bg-transparent border-none outline-none text-sm text-dark-bg dark:text-light-bg w-40"
                                        />
                                        {tagInputValue.trim() && (
                                            <button
                                                onClick={handleTagSubmit}
                                                className="p-1 hover:bg-dark-bg/10 dark:hover:bg-light-bg/10 rounded transition-colors text-indigo-500 dark:text-indigo-400"
                                                title="Add tag"
                                            >
                                                <Plus size={16} />
                                            </button>
                                        )}
                                    </div>
                                    {suggestedTags.length > 0 && (
                                        <div
                                            className="mt-1 border-t border-light-border dark:border-dark-border pt-1 px-2 pb-1 flex flex-col gap-0.5"
                                        >
                                            {suggestedTags.map((tagMatch, idx) => (
                                                <button
                                                    key={tagMatch}
                                                    onClick={() => {
                                                        setTagInputValue(tagMatch);
                                                        tagInputRef.current?.focus();
                                                    }}
                                                    className={`w-full text-left text-xs rounded px-1.5 py-1 flex justify-between items-center group/sug ${idx === selectedSuggestionIndex
                                                        ? 'bg-dark-bg/10 dark:bg-light-bg/10 text-dark-bg dark:text-light-bg'
                                                        : 'text-dark-bg/70 dark:text-light-bg/70 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5'
                                                        }`}
                                                >
                                                    <span>#{tagMatch}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Title ── */}
                <input
                    ref={titleInputRef}
                    className="w-full text-4xl font-bold bg-transparent border-none outline-none
                               text-dark-bg dark:text-light-bg
                               placeholder-dark-bg/30 dark:placeholder-light-bg/30
                               mb-3 leading-tight tracking-tight"
                    style={{ fontFamily: 'inherit', letterSpacing: '-0.01em' }}
                    value={title}
                    onChange={handleTitleChange}
                    placeholder="Untitled"
                />

                {/* ── Tags List (Below Title) ── */}
                {note.tags && note.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-6">
                        {note.tags.map(tag => (
                            <div key={tag} className="group/pill relative flex items-center bg-dark-bg/5 dark:bg-light-bg/5 text-dark-bg/70 dark:text-light-bg/70 px-2 py-1 md:py-0.5 rounded text-xs font-medium border border-dark-bg/2 dark:border-light-bg/2 transition-colors hover:bg-dark-bg/10 dark:hover:bg-light-bg/10">
                                <span>#{tag}</span>
                                <button
                                    onClick={() => handleRemoveTag(tag)}
                                    className="absolute -top-1.5 -right-1.5 opacity-0 group-hover/pill:opacity-100 transition-all bg-light-bg dark:bg-[#1a1a1f] text-red-500 rounded-full p-1.5 md:p-0.5 shadow-md border border-black/5 dark:border-white/10 z-10 scale-100 md:scale-75 group-hover/pill:scale-100"
                                    title={`Remove #${tag}`}
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* ── Editor body — same column, no extra wrappers ── */}
                <div className="milkdown-wrapper" key={`${noteId}-${syncRevision}`}>
                    <MilkdownProvider>
                        <CrepeBody
                            noteId={noteId}
                            content={noteContent?.content ?? ''}
                            onSave={debouncedSaveContent}
                        />
                    </MilkdownProvider>
                </div>
            </div>
        </div>
    );
}
