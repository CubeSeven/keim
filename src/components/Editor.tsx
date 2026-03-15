import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getFullPath, getItemPath } from '../lib/db';
import { triggerAutoSync } from '../lib/sync';
import { getStorageMode, notePathFromTitle, writeNoteToVault } from '../lib/vault';
import { updateSearchIndex } from '../lib/search';
import { ENABLE_SMART_PROPS } from '../constants';
import { parseYamlFrontmatter, serializeYamlFrontmatter } from '../lib/smartProps';
import PropertiesHeader from './PropertiesHeader';

import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import EmojiPicker from 'emoji-picker-react';
import { SmilePlus, X, Tag, Plus, Lock, ArrowRight, CloudDownload, Cloud } from 'lucide-react';
import { mirage } from 'ldrs';
mirage.register();
import type { SyncStatus } from '../App';
import { editorViewOptionsCtx, editorViewCtx, parserCtx } from '@milkdown/kit/core';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { TextSelection } from '@milkdown/prose/state';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { ProsemirrorAdapterProvider, useNodeViewFactory } from '@prosemirror-adapter/react';
import { $view, $prose } from '@milkdown/kit/utils';
import { remarkDirectivePlugin, remarkDirectiveFallbackPlugin, dashboardNode } from '../plugins/dashboardNode';
import { DashboardNodeView } from '../plugins/DashboardNodeView';
import { DashboardFolderPicker } from './DashboardFolderPicker';
import 'katex/dist/katex.min.css';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

interface EditorProps {
    noteId: number;
    isVaultLocked?: boolean;
    onUnlockVault?: () => Promise<boolean>;
    onSelectNote: (id: number) => void;
    syncStatus?: SyncStatus;
    lastSyncTime?: number | null;
}

interface CrepeBodyProps {
    content: string;
    noteId: number;
    onSave: (markdown: string) => void;
    onSelectNote: (id: number) => void;
}

// Custom Prosemirror plugin to track when cursor is eligible for the slash menu (start of block)
const slashCursorTrackerPlugin = $prose(() => new Plugin({
    key: new PluginKey('SLASH_CURSOR_TRACKER'),
    view: () => ({
        update: (view) => {
            const { selection } = view.state;
            const isEligible = selection.empty && 
                               selection.$from.parent.type.name === 'paragraph' && 
                               selection.$from.parent.textContent.length === 0;
            window.dispatchEvent(new CustomEvent('keim_slash_eligibility_changed', { detail: isEligible }));
        }
    })
}));

// --- Module-level write-through buffer ---
// Key: noteId, Value: latest markdown content
// Synchronous — always up to date, never lost on unmount.
const contentBuffer = new Map<number, string>();

function CrepeBodyInner({ content, noteId, onSave, onSelectNote }: CrepeBodyProps) {
    const onSaveRef = useRef(onSave);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const onSelectNoteRef = useRef((_id: number) => { });
    const factory = useNodeViewFactory();
    const [showFolderPicker, setShowFolderPicker] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingInsertRef = useRef<{ from: number; view: any } | null>(null);

    useEffect(() => {
        onSaveRef.current = onSave;
    }, [onSave]);

    useEffect(() => {
        onSelectNoteRef.current = onSelectNote;
    }, [onSelectNote]);

    const [loading, get] = useInstance();

    // Listen for seamless cloud sync replaces (instead of remounting the editor)
    useEffect(() => {
        const handleSyncReplace = (e: CustomEvent) => {
            if (e.detail.noteId === noteId && !loading && get()) {
                const editor = get();
                // When we have new content from the cloud or "use cloud version",
                // we gracefully replace the editor text without unmounting plugins
                editor.action((ctx) => {
                    const view = ctx.get(editorViewCtx);
                    const parser = ctx.get(parserCtx);
                    const doc = parser(e.detail.content);
                    
                    if (!doc) return;
                    
                    const state = view.state;
                    let tr = state.tr.replaceWith(0, state.doc.content.size, doc.content);
                    
                    // Explicitly set selection to the start of the new document to avoid RangeError
                    // if the previous selection is out of bounds in the newly generated document context
                    tr = tr.setSelection(TextSelection.atStart(tr.doc));
                    tr = tr.setMeta('addToHistory', false);
                    view.dispatch(tr);
                });
            }
        };
        window.addEventListener('keim_editor_replace_content', handleSyncReplace as EventListener);
        return () => window.removeEventListener('keim_editor_replace_content', handleSyncReplace as EventListener);
    }, [noteId, loading, get]);

    // Listen for the custom dashboard insert event from the slash menu
    useEffect(() => {
        const handler = (e: Event) => {
            const { from, view } = (e as CustomEvent).detail;
            pendingInsertRef.current = { from, view };
            setShowFolderPicker(true);
        };
        window.addEventListener('keim-insert-dashboard', handler);
        return () => window.removeEventListener('keim-insert-dashboard', handler);
    }, []);

    // Listen for slash menu trigger from Navigation Dock
    useEffect(() => {
        const handler = () => {
            if (!loading && get()) {
                const editor = get();
                editor.action((ctx) => {
                    const view = ctx.get(editorViewCtx);
                    // Focus the editor if it isn't already focused
                    if (!view.hasFocus()) {
                        view.focus();
                    }
                    // Insert a '/' at the current cursor position
                    const tr = view.state.tr.insertText('/');
                    view.dispatch(tr);
                });
            }
        };
        window.addEventListener('keim_trigger_slash_menu', handler);
        return () => window.removeEventListener('keim_trigger_slash_menu', handler);
    }, [loading, get]);

    const handleFolderPicked = (folderName: string) => {
        const pending = pendingInsertRef.current;
        if (pending) {
            const { from, view } = pending;
            const { state, dispatch } = view;
            const nodeType = state.schema.nodes['dashboard'];
            if (nodeType) {
                const node = nodeType.create({ folder: folderName });
                const insertPos = state.doc.resolve(from).start();
                const tr = state.tr
                    .deleteRange(insertPos, from)
                    .insert(insertPos, node);
                dispatch(tr);
            }
            pendingInsertRef.current = null;
        }
        setShowFolderPicker(false);
    };

    const initialBody = parseYamlFrontmatter(content).body;

    useEditor(
        (root) => {
            const crepe = new Crepe({
                root,
                defaultValue: initialBody,
                featureConfigs: {
                    [CrepeFeature.BlockEdit]: {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        buildMenu: (builder: any) => {
                            const advancedGroup = builder.getGroup('advanced');
                            if (advancedGroup) {
                                advancedGroup.addItem('dashboard', {
                                    label: 'Dashboard (Smart Folder)',
                                    icon: `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <g clip-path="url(#clip0_977_8078)">
      <path
        d="M20 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H20C21.1 21 22 20.1 22 19V5C22 3.9 21.1 3 20 3ZM20 5V8H5V5H20ZM15 19H10V10H15V19ZM5 10H8V19H5V10ZM17 19V10H20V19H17Z"
      />
    </g>
    <defs>
      <clipPath id="clip0_977_8078">
        <rect width="24" height="24" />
      </clipPath>
    </defs>
  </svg>
`,
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    onRun: (editorCtx: any) => {
                                        const view = editorCtx.get(editorViewCtx);
                                        const { from } = view.state.selection;
                                        // Dispatch custom event so React can show the folder picker
                                        window.dispatchEvent(new CustomEvent('keim-insert-dashboard', {
                                            detail: { from, view }
                                        }));
                                    }
                                });
                            }
                        }
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    } as any
                }
            });

            let isFirstUpdate = true;

    crepe.editor
        .config((ctx) => {
            // --- Android Double-Enter Fix ---
            // Intercept Enter key on Android to prevent the browser from 
            // inserting a native newline alongside Milkdown's handler.
            ctx.update(editorViewOptionsCtx, (prev) => ({
                ...prev,
                handleKeyDown: (_view, event) => {
                    const isAndroid = /Android/i.test(navigator.userAgent);
                    if (isAndroid && event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault(); // Stop native ghost newline
                        // Let Milkdown's keymap handles it.
                        return false; 
                    }
                    return false;
                }
            }));

            ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
                        // Prevent phantom saves on initial mount, but don't swallow user edits.
                        // Milkdown sometimes formats the initial parsed markdown.
                        if (isFirstUpdate) {
                            isFirstUpdate = false;
                            const cleanMarkdown = markdown.trim();
                            const cleanBody = initialBody.trim();
                            if (cleanMarkdown === cleanBody || cleanMarkdown === '') {
                                return; // Ignore un-edited initialization
                            }
                        }
                        
                        // We must fetch the latest meta from the buffer or initialContent,
                        // and append this new body to it!
                        const currentFull = contentBuffer.get(noteId) ?? content;
                        const { meta } = parseYamlFrontmatter(currentFull);
                        const newFull = serializeYamlFrontmatter(meta, markdown);

                        // 1. Synchronous buffer — NEVER lost, even on instant unmount
                        contentBuffer.set(noteId, newFull);
                        // 2. Debounced DB persist via parent callback
                        onSaveRef.current(newFull);
                    });
                })
                .use(remarkDirectivePlugin)
                .use(remarkDirectiveFallbackPlugin)
                .use(slashCursorTrackerPlugin)
                .use(dashboardNode)
                .use($view(dashboardNode.node, () => factory({ 
                    component: () => <DashboardNodeView onSelectNote={(id) => onSelectNoteRef.current(id)} />,
                    stopEvent: () => true, // Tell ProseMirror to completely ignore all DOM events inside this node
                    ignoreMutation: () => true // Tell ProseMirror to ignore all DOM changes inside React
                })))
                .use(listener);

            return crepe;
        },
        [noteId]
    );

    // Pass latest prop safely to the adapter without breaking memoization
    useEffect(() => {
        // If we needed to access the parent's generic onSelectNote we would do it here
    }, []);

    return (
        <>
            <Milkdown />
            {showFolderPicker && (
                <DashboardFolderPicker
                    onPick={handleFolderPicked}
                    onClose={() => setShowFolderPicker(false)}
                />
            )}
        </>
    );
}

function CrepeBody(props: CrepeBodyProps) {
    return (
        <ProsemirrorAdapterProvider>
            <CrepeBodyInner {...props} />
        </ProsemirrorAdapterProvider>
    );
}

export default function Editor({ noteId, isVaultLocked, onUnlockVault, onSelectNote, syncStatus, lastSyncTime }: EditorProps) {
    const note = useLiveQuery(() => db.items.get(noteId), [noteId]);
    const noteContent = useLiveQuery(() => db.contents.get(noteId), [noteId]);
    const smartSchema = useLiveQuery(() => 
        (note?.parentId && ENABLE_SMART_PROPS) ? db.smartSchemas.where({ folderId: note.parentId }).first() : undefined,
    [note?.parentId]);
    const [title, setTitle] = useState('');
    const saveTimeoutRef = useRef<number | null>(null);
    // Conflict state: set when sync wants to overwrite a note the user is actively editing
    const [conflictPending, setConflictPending] = useState(false);
    // Toast: briefly shown after a non-conflicting cloud update
    const [cloudUpdateToast, setCloudUpdateToast] = useState(false);
    const cloudToastTimer = useRef<number | null>(null);

    // The content to seed the editor with comes from three sources, in priority order:
    // 1. The synchronous in-memory buffer (user typed but DB not yet written)
    // 2. The IndexedDB content (freshly loaded from DB)
    // 3. null => still loading from DB (noteContent is undefined from useLiveQuery)
    //
    // We use a separate 'editorReady' flag to distinguish between
    // "DB says empty string" (editorReady=true, content='') and
    // "DB hasn't responded yet" (editorReady=false). This prevents the
    // editor from flickering by only mounting once we have authoritative content.
    const dbLoaded = noteContent !== undefined; // undefined = Dexie still loading
    const initialContent = useMemo(() => {
        const buffered = contentBuffer.get(noteId);
        if (buffered !== undefined) return buffered;  // User typed — use buffer
        if (!dbLoaded) return '';                     // Still loading — show empty skeleton
        return noteContent?.content ?? '';            // DB authoritative result
    }, [noteId, noteContent, dbLoaded]);
    const editorReady = dbLoaded || contentBuffer.has(noteId);

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
    const [recentTags, setRecentTags] = useState<string[]>([]);
    const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
    const tagInputRef = useRef<HTMLInputElement>(null);
    const tagContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (showTagInput) {
            db.items.filter(i => !i.isDeleted).toArray().then(items => {
                // All unique tags for filtering
                const tags = new Set<string>();
                items.forEach(i => {
                    if (i.tags) i.tags.forEach(t => tags.add(t));
                });
                setUniqueTags(Array.from(tags));

                // Recent tags: based on last modified notes
                const recent = new Set<string>();
                const sortedItems = [...items].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
                for (const item of sortedItems) {
                    if (item.tags) {
                        item.tags.forEach(t => {
                            if (recent.size < 5) recent.add(t);
                        });
                    }
                    if (recent.size >= 5) break;
                }
                setRecentTags(Array.from(recent));
            });
        }
    }, [showTagInput]);

    const suggestedTags = useMemo(() => {
        const cleanVal = tagInputValue.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
        if (cleanVal.length > 0) {
            return uniqueTags.filter(t => t.startsWith(cleanVal) && t !== cleanVal).slice(0, 5);
        }
        // If empty input, show recent tags
        return recentTags;
    }, [tagInputValue, uniqueTags, recentTags]);

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
                    const allItems = await db.items.toArray();
                    const fullPath = getFullPath(noteId, allItems);
                    updateSearchIndex(noteId, note.title, noteContent.content, note.parentId, fullPath, note.icon, newTags);
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
                const allItems = await db.items.toArray();
                const fullPath = getFullPath(noteId, allItems);
                updateSearchIndex(noteId, note.title, noteContent.content, note.parentId, fullPath, note.icon, newTags);
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
                // RACE CONDITION GUARD: If the user has unsaved pending edits, do NOT
                // silently overwrite them. Show a conflict banner instead.
                if (pendingSaveRef.current !== null) {
                    setConflictPending(true);
                    return;
                }
                
                db.contents.get(noteId).then(contentObj => {
                    const newContent = contentObj?.content || '';
                    contentBuffer.set(noteId, newContent);
                    window.dispatchEvent(new CustomEvent('keim_editor_replace_content', {
                        detail: { noteId, content: newContent }
                    }));
                });

                // Show a brief "Updated from cloud" toast for non-conflicting updates
                if (cloudToastTimer.current) window.clearTimeout(cloudToastTimer.current);
                setCloudUpdateToast(true);
                cloudToastTimer.current = window.setTimeout(() => setCloudUpdateToast(false), 3000);
            }
        }) as EventListener;
        window.addEventListener('keim_sync_complete', handleSyncComplete);

        const handleNoteUpdated = ((e: CustomEvent) => {
            const { noteId: editedId, newContent } = e.detail;
            
            console.log(`[Editor] Received keim_note_content_updated for note ${editedId}. Current active note is ${noteId}`);
            
            // Always update global buffer so if the user opens this note later, it's fresh.
            // PropertiesHeader manages its own meta state by listening to the event directly.
            contentBuffer.set(editedId, newContent);
        }) as EventListener;
        window.addEventListener('keim_note_content_updated', handleNoteUpdated);

        return () => {
            window.removeEventListener('keim_sync_complete', handleSyncComplete);
            window.removeEventListener('keim_note_content_updated', handleNoteUpdated);
        };
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

    const pendingSaveRef = useRef<string | null>(null);
    // noteRef keeps a non-stale reference to `note` so cleanup functions can use it
    const noteRef = useRef(note);
    useEffect(() => { noteRef.current = note; }, [note]);

    const persistContent = useCallback(async (markdown: string, noteItem: typeof note) => {
        if (!noteItem) return;
        await db.contents.put({ id: noteId, content: markdown });
        await db.items.update(noteId, { updated_at: Date.now() });
        const allItems = await db.items.toArray();
        const fullPath = getFullPath(noteId, allItems);
        updateSearchIndex(noteId, noteItem.title, markdown, noteItem.parentId, fullPath, noteItem.icon, noteItem.tags);
        localStorage.setItem('keim_has_user_edits', 'true');
        // NOTE: No live vault write here intentionally.
        // The vault is a sync-only mirror — reconcileVault (called on every Dropbox
        // sync cycle) keeps .md files up to date without hammering the disk on every keystroke.
        triggerAutoSync();
    }, [noteId]);

    const debouncedSaveContent = useCallback(
        (markdown: string) => {
            pendingSaveRef.current = markdown;

            // Sync contentBuffer immediately for cross-component consistency
            // NOTE: PropertiesHeader dispatches keim_note_content_updated itself;
            // the Milkdown body editor does NOT need to dispatch for plain typing
            // (it affects body text, not properties).
            if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = window.setTimeout(() => {
                pendingSaveRef.current = null;
                persistContent(markdown, noteRef.current);
            }, 500);
        },
        [persistContent]
    );

    // On unmount: flush any pending debounced save immediately.
    // The contentBuffer already preserved the text synchronously;
    // this ensures the DB is also written ASAP.
    useEffect(() => {
        return () => {
            const pending = pendingSaveRef.current;
            if (pending !== null && saveTimeoutRef.current !== null) {
                window.clearTimeout(saveTimeoutRef.current);
                // Fire-and-forget — content_buffer is the safety net
                persistContent(pending, noteRef.current);
            }
        };
    }, [persistContent]);

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
                    const parentPath = getItemPath(oldNote.parentId, allItems);
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
                const allItems = await db.items.toArray();
                const fullPath = getFullPath(noteId, allItems);
                updateSearchIndex(noteId, newTitle, contentObj.content, note.parentId, fullPath, note.icon, note.tags);
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

    if (!note || !editorReady) {
        return (
            <div className="h-full overflow-y-auto">
                <div 
                    className="mx-auto w-full px-6 md:px-12 lg:px-16 pb-64 animate-pulse mt-8"
                    style={{
                        maxWidth: initialContent.includes('::dashboard') ? 'none' : '900px',
                        paddingTop: window.innerWidth < 768 ? 'calc(5rem + var(--spacing-safe-top, 0px))' : 'calc(3rem + var(--spacing-safe-top, 0px))'
                    }}
                >
                    {/* Title Skeleton */}
                    <div className="h-10 bg-dark-bg/5 dark:bg-light-bg/5 rounded-lg w-2/3 mb-10"></div>
                    
                    {/* Body Skeletons */}
                    <div className="space-y-4">
                        <div className="h-4 bg-dark-bg/5 dark:bg-light-bg/5 rounded w-full"></div>
                        <div className="h-4 bg-dark-bg/5 dark:bg-light-bg/5 rounded w-5/6"></div>
                        <div className="h-4 bg-dark-bg/5 dark:bg-light-bg/5 rounded w-4/6"></div>
                        <div className="h-4 bg-dark-bg/5 dark:bg-light-bg/5 rounded w-full"></div>
                        <div className="h-4 bg-dark-bg/5 dark:bg-light-bg/5 rounded w-3/4"></div>
                    </div>
                </div>
            </div>
        );
    }

    // Handlers for conflict resolution banner
    const handleKeepMine = () => {
        // User keeps their local version — mark as saved to push it to cloud
        setConflictPending(false);
        const buffered = contentBuffer.get(noteId);
        if (buffered !== undefined) {
            persistContent(buffered, note);
        }
    };
    const handleUseCloud = () => {
        // User accepts cloud version — clear buffer and seamlessly update editor text
        contentBuffer.delete(noteId);
        setConflictPending(false);
        db.contents.get(noteId).then(contentObj => {
            const newContent = contentObj?.content || '';
            window.dispatchEvent(new CustomEvent('keim_editor_replace_content', {
                detail: { noteId, content: newContent }
            }));
        });
    };

    return (
        /* Full-height scroll container */
        <div className="h-full overflow-y-auto">
            {/* Notion-style: centered column, comfortable max-width, generous top padding */}
            <div
                className="mx-auto w-full px-6 md:px-12 lg:px-16 pb-64"
                style={{
                    maxWidth: initialContent.includes('::dashboard') ? 'none' : '900px',
                    paddingTop: window.innerWidth < 768 ? 'calc(5rem + var(--spacing-safe-top, 0px))' : 'calc(3rem + var(--spacing-safe-top, 0px))'
                }}
            >
                {/* ── Initial Sync Banner (first session sync, no lastSyncTime yet) ── */}
                {syncStatus === 'syncing' && !lastSyncTime && (
                    <div className="mb-6 px-4 py-3 rounded-lg bg-indigo-500/8 border border-indigo-500/15 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
                        <div className="flex items-center shrink-0">
                            <l-mirage size="32" speed="2.5" color="rgb(129 140 248)" />
                        </div>
                        <p className="text-xs text-dark-bg/60 dark:text-light-bg/60 leading-tight">
                            Syncing latest content from cloud — content may update shortly.
                        </p>
                    </div>
                )}

                {/* ── Conflict Banner ── */}
                {conflictPending && (
                    <div className="mb-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/25 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                                <Cloud size={16} className="text-amber-500" />
                            </div>
                            <div className="text-left">
                                <h4 className="text-sm font-bold text-dark-bg dark:text-light-bg leading-tight">Cloud has a newer version</h4>
                                <p className="text-[11px] text-dark-bg/60 dark:text-light-bg/60 leading-tight mt-0.5">You were editing while a newer version synced from another device.</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-auto">
                            <button
                                onClick={handleKeepMine}
                                className="px-3 py-1.5 rounded-lg bg-dark-bg/8 dark:bg-light-bg/8 text-dark-bg dark:text-light-bg text-xs font-semibold hover:bg-dark-bg/15 dark:hover:bg-light-bg/15 transition-colors"
                            >
                                Keep mine
                            </button>
                            <button
                                onClick={handleUseCloud}
                                className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors shadow-sm"
                            >
                                Use cloud version
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Cloud Update Toast ── */}
                {cloudUpdateToast && (
                    <div className="mb-4 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-200">
                        <CloudDownload size={13} strokeWidth={2} />
                        <span className="font-medium">Note updated from cloud</span>
                    </div>
                )}

                {/* ── Vault Locked Banner ── */}
                {isVaultLocked && (
                    <div className="mb-10 p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex flex-col md:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4 duration-300">
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
                                <div className="absolute z-50 top-full left-0 mt-1 bg-light-bg/85 dark:bg-[#1a1a1f]/80 backdrop-blur-xl shadow-2xl rounded-lg border border-black/5 dark:border-white/10 p-1">
                                    <div className="flex items-center px-2 py-1 gap-1.5 relative">
                                        <span className="text-dark-bg/40 dark:text-light-bg/40 font-medium">#</span>
                                        <input
                                            ref={tagInputRef}
                                            type="text"
                                            value={tagInputValue}
                                            onChange={(e) => setTagInputValue(e.target.value)}
                                            onKeyDown={handleAddTag}
                                            placeholder="tag..."
                                            className="bg-transparent border-none outline-none text-sm text-dark-bg dark:text-light-bg w-28 md:w-32"
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
                                            className="mt-1 border-t border-black/5 dark:border-white/10 pt-1.5 px-2 pb-1.5 flex flex-col gap-0.5"
                                        >
                                            {!tagInputValue && (
                                                <div className="text-[10px] font-bold text-dark-bg/30 dark:text-light-bg/30 uppercase tracking-widest px-1.5 mb-1 select-none">Recent</div>
                                            )}
                                            {suggestedTags.map((tagMatch, idx) => (
                                                <button
                                                    key={tagMatch || idx}
                                                    onClick={() => {
                                                        setTagInputValue(tagMatch);
                                                        tagInputRef.current?.focus();
                                                    }}
                                                    className={`w-full text-left text-xs rounded px-1.5 py-1.5 flex justify-between items-center group/sug ${idx === selectedSuggestionIndex
                                                        ? 'bg-dark-bg/10 dark:bg-light-bg/10 text-dark-bg dark:text-light-bg'
                                                        : 'text-dark-bg/70 dark:text-light-bg/70 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5'
                                                        }`}
                                                >
                                                    <span className="font-medium">#{tagMatch}</span>
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
                               mb-5 leading-tight tracking-tight"
                    style={{ fontFamily: 'inherit', letterSpacing: '-0.01em' }}
                    value={title}
                    onChange={handleTitleChange}
                    placeholder="Untitled"
                />

                {/* ── Smart Properties Header ── */}
                {smartSchema && (
                    <PropertiesHeader 
                        schema={smartSchema}
                        content={initialContent}
                        noteId={noteId}
                        onUpdateContent={(nc) => {
                            contentBuffer.set(noteId, nc);
                            debouncedSaveContent(nc);
                        }}
                        onSelectNote={onSelectNote}
                    />
                )}

                {/* ── Tags List (Below Title) ── */}
                {note.tags && note.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-6">
                        {note.tags.map((tag, i) => (
                            <div key={`${tag}-${i}`} className="group/pill relative flex items-center bg-dark-bg/5 dark:bg-light-bg/5 text-dark-bg/70 dark:text-light-bg/70 px-2 py-1 md:py-0.5 rounded text-xs font-medium border border-dark-bg/2 dark:border-light-bg/2 transition-colors hover:bg-dark-bg/10 dark:hover:bg-light-bg/10">
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
                <div className="milkdown-wrapper" key={noteId}>
                    <MilkdownProvider>
                        <CrepeBody
                            noteId={noteId}
                            content={initialContent}
                            onSave={debouncedSaveContent}
                            onSelectNote={onSelectNote}
                        />
                    </MilkdownProvider>
                </div>
            </div>
        </div>
    );
}
