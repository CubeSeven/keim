import { useEffect, useState, useCallback, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getFullPath } from '../lib/db';
import { triggerAutoSync } from '../lib/sync';
import { getStorageMode, writeNoteToVault, notePathFromTitle } from '../lib/vault';
import { updateSearchIndex } from '../lib/search';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { Crepe } from '@milkdown/crepe';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import 'katex/dist/katex.min.css';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

interface EditorProps {
    noteId: number;
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

export default function Editor({ noteId }: EditorProps) {
    const note = useLiveQuery(() => db.items.get(noteId), [noteId]);
    const noteContent = useLiveQuery(() => db.contents.get(noteId), [noteId]);
    const [title, setTitle] = useState('');
    const saveTimeoutRef = useRef<number | null>(null);
    const [syncRevision, setSyncRevision] = useState(0);

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
                    updateSearchIndex(noteId, note.title, markdown, note.parentId);
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
            await db.items.update(noteId, { title: newTitle, updated_at: Date.now() });
            if (note && noteContent) {
                updateSearchIndex(noteId, newTitle, noteContent.content, note.parentId);
            }
            localStorage.setItem('keim_has_user_edits', 'true');
            triggerAutoSync();
        }, 500);
    };

    if (!note || noteContent === undefined) return null;

    return (
        /* Full-height scroll container */
        <div className="h-full overflow-y-auto">
            {/* Notion-style: centered column, comfortable max-width, generous top padding */}
            <div className="mx-auto w-full px-6 md:px-12 lg:px-24 pt-12 md:pt-24 pb-64" style={{ maxWidth: '720px' }}>

                {/* ── Title ── */}
                <input
                    className="w-full text-4xl font-bold bg-transparent border-none outline-none
                               text-dark-bg dark:text-light-bg
                               placeholder-dark-bg/30 dark:placeholder-light-bg/30
                               mb-3 leading-tight tracking-tight"
                    style={{ fontFamily: 'inherit', letterSpacing: '-0.01em' }}
                    value={title}
                    onChange={handleTitleChange}
                    placeholder="Untitled"
                />

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
