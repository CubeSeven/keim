import { useEffect, useState, useCallback, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { triggerAutoSync } from '../lib/sync';
import { getStorageMode, writeNoteToVault, notePathFromTitle } from '../lib/vault';
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

            crepe.editor
                .config((ctx) => {
                    ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
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

    useEffect(() => {
        if (note) {
            setTitle(note.title);
        } else {
            setTitle('');
        }
    }, [note]);

    const debouncedSaveContent = useCallback(
        (markdown: string) => {
            if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = window.setTimeout(async () => {
                await db.contents.put({ id: noteId, content: markdown });
                await db.items.update(noteId, { updated_at: Date.now() });
                // Write to vault if active
                if (note && getStorageMode() === 'vault') {
                    const path = notePathFromTitle(note.title, note.parentPath ?? '');
                    writeNoteToVault(path, markdown).catch(console.warn);
                }
                triggerAutoSync();
            }, 500);
        },
        [noteId, note]
    );

    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTitle = e.target.value;
        setTitle(newTitle);
        db.items.update(noteId, { title: newTitle, updated_at: Date.now() });
        triggerAutoSync();
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
                <div className="milkdown-wrapper">
                    <MilkdownProvider>
                        <CrepeBody
                            key={noteId}
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
