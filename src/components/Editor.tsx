import { useEffect, useRef, useState, useCallback } from 'react';
import { readNoteContent, writeNoteToVault, renameNote, reloadTree, updateWikilinksOnRename, parentPathOf, titleFromNotePath } from '../lib/vault';
import { extractWikiLinks, resolveWikiLink } from '../lib/wikilinks';
import { useAppStore } from '../store';
import { Link2 } from 'lucide-react';

interface EditorProps {
    notePath: string;
    onSelectNote: (path: string | null) => void;
}

export default function Editor({ notePath, onSelectNote }: EditorProps) {
    const [content, setContent] = useState('');
    const [title, setTitle] = useState('');
    const [loading, setLoading] = useState(true);
    const saveTimer = useRef<number | null>(null);
    const contentRef = useRef('');
    const titleRef = useRef('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Wikilink autocomplete state
    const [wikiQuery, setWikiQuery] = useState<string | null>(null); // null = not in a [[ context
    const [wikiStart, setWikiStart] = useState(0);
    const [wikiActive, setWikiActive] = useState(0);

    const setSaving = useAppStore(s => s.setSaving);
    const setLastSavedTime = useAppStore(s => s.setLastSavedTime);

    const load = useCallback(async (path: string) => {
        setLoading(true);
        try {
            const text = await readNoteContent(path);
            contentRef.current = text;
            setContent(text);
            const t = titleFromNotePath(path);
            titleRef.current = t;
            setTitle(t);
            setSaving(false);
            setLastSavedTime(null);
        } catch (e) {
            console.error('Failed to read note', e);
            contentRef.current = '';
            setContent('');
            setTitle(titleFromNotePath(path));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(notePath); }, [notePath, load]);

    const persist = useCallback((path: string, body: string) => {
        setSaving(true);
        window.clearTimeout(saveTimer.current ?? undefined);
        saveTimer.current = window.setTimeout(async () => {
            try {
                await writeNoteToVault(path, body);
                setSaving(false);
                setLastSavedTime(Date.now());
            } catch (e) {
                console.error('Failed to save note', e);
                setSaving(false);
            }
        }, 400);
    }, []);

    const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const v = e.target.value;
        contentRef.current = v;
        setContent(v);
        setSaving(true);
        persist(notePath, v);
        detectWikiTrigger(e.target);
    };

    // Detect an active [[ ... ]] context to show autocomplete
    const detectWikiTrigger = (el: HTMLTextAreaElement) => {
        const pos = el.selectionStart ?? el.value.length;
        const before = el.value.slice(0, pos);
        const open = before.lastIndexOf('[[');
        if (open === -1) { setWikiQuery(null); return; }
        // must not already be closed
        const between = before.slice(open + 2);
        if (between.includes(']]')) { setWikiQuery(null); return; }
        setWikiQuery(between);
        setWikiStart(open);
        setWikiActive(0);
    };

    const commitTitle = useCallback(async () => {
        const newTitle = titleRef.current.trim() || 'Untitled';
        if (titleFromNotePath(notePath) === newTitle) return;
        try {
            const oldTitle = titleFromNotePath(notePath);
            const newPath = await renameNote(notePath, newTitle);
            await updateWikilinksOnRename(oldTitle, newTitle);
            const { setTree } = useAppStore.getState();
            setTree(await reloadTree());
            useAppStore.getState().setSelectedNotePath(newPath);
        } catch (e) {
            console.error('Failed to rename note', e);
        }
    }, [notePath]);

    const wikiIndex = useAppStore(s => s.wikiIndex);
    const linkedTitles = wikiQuery !== null
        ? Array.from(wikiIndex.keys())
            .filter(t => t.toLowerCase().includes(wikiQuery.toLowerCase()) && t !== titleFromNotePath(notePath))
            .slice(0, 8)
        : [];

    const insertWikiLink = (targetTitle: string) => {
        const el = textareaRef.current;
        if (!el) return;
        const pos = el.selectionStart ?? contentRef.current.length;
        const start = wikiStart >= 0 ? wikiStart : pos - 2;
        const before = contentRef.current.slice(0, start);
        const after = contentRef.current.slice(pos);
        const inserted = `[[${targetTitle}]]`;
        const next = before + inserted + after;
        contentRef.current = next;
        setContent(next);
        setWikiQuery(null);
        const caret = (before + inserted).length;
        requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(caret, caret);
        });
        persist(notePath, next);
    };

    const linkedNotes = extractWikiLinks(contentRef.current)
        .map(t => ({ title: t, path: resolveWikiLink(t, wikiIndex) }))
        .filter((_, i, arr) => arr.findIndex(x => x.title === _.title) === i);

    const openLinked = (path: string) => {
        onSelectNote(path);
    };

    if (loading) {
        return <div className="flex-1 flex items-center justify-center text-dark-bg/40 dark:text-light-bg/40">Loading…</div>;
    }

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            <div className="w-full max-w-[900px] mx-auto px-6 md:px-12 lg:px-16">
                <div className="flex items-center gap-2 pt-16 md:pt-20 pb-2">
                    <input
                        value={title}
                        onChange={handleTitleChange}
                        onBlur={commitTitle}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                        placeholder="Note title"
                        className="flex-1 bg-transparent text-2xl font-bold tracking-tight text-dark-bg dark:text-light-bg outline-none placeholder:text-dark-bg/30 dark:placeholder:text-light-bg/30"
                    />
                </div>
                <div className="pb-2 flex items-center gap-2 text-xs text-dark-bg/40 dark:text-light-bg/40">
                    <span className="font-mono">{parentPathOf(notePath) || 'root'}/{titleFromNotePath(notePath)}.md</span>
                </div>

                {linkedNotes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pb-2">
                        <Link2 size={13} className="text-dark-bg/30 dark:text-light-bg/30 shrink-0" />
                        {linkedNotes.map(({ title: lt, path }) => (
                            path ? (
                                <button
                                    key={lt}
                                    onClick={() => openLinked(path)}
                                    className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                                    title={`Open ${lt}`}
                                >
                                    {lt}
                                </button>
                            ) : (
                                <span key={lt} className="text-xs px-2 py-0.5 rounded-full bg-dark-bg/5 dark:bg-light-bg/5 text-dark-bg/30 dark:text-light-bg/30 line-through" title="Note not found">
                                    {lt}
                                </span>
                            )
                        ))}
                    </div>
                )}
            </div>

            <div className="relative flex-1">
                <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={handleContentChange}
                    onBlur={() => { setWikiQuery(null); persist(notePath, contentRef.current); }}
                    onKeyDown={(e) => {
                        if (wikiQuery !== null && linkedTitles.length > 0) {
                            if (e.key === 'ArrowDown') { e.preventDefault(); setWikiActive(a => Math.min(a + 1, linkedTitles.length - 1)); return; }
                            if (e.key === 'ArrowUp') { e.preventDefault(); setWikiActive(a => Math.max(a - 1, 0)); return; }
                            if (e.key === 'Enter') { e.preventDefault(); insertWikiLink(linkedTitles[wikiActive]); return; }
                            if (e.key === 'Escape') { e.preventDefault(); setWikiQuery(null); return; }
                        }
                    }}
                    placeholder="Write your notes in plain Markdown…"
                    spellCheck
                    className="absolute inset-0 w-full max-w-[900px] mx-auto left-0 right-0 resize-none outline-none bg-transparent text-dark-bg dark:text-light-bg leading-relaxed px-6 md:px-12 lg:px-16 pb-64 pt-2 text-[15px] font-mono"
                />

                {wikiQuery !== null && linkedTitles.length > 0 && (
                    <div className="absolute z-30 left-6 md:left-12 lg:left-16 top-[112px] md:top-[128px] w-72 max-w-[calc(100%-3rem)] bg-light-ui/95 dark:bg-dark-ui/95 backdrop-blur-xl border border-black/5 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden animate-scalein">
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-dark-bg/40 dark:text-light-bg/40 border-b border-black/5 dark:border-white/5">
                            Link to note
                        </div>
                        <div className="max-h-56 overflow-y-auto py-1 scrollbar-hide">
                            {linkedTitles.map((t, i) => (
                                <button
                                    key={t}
                                    onMouseDown={(e) => { e.preventDefault(); insertWikiLink(t); }}
                                    onMouseEnter={() => setWikiActive(i)}
                                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${i === wikiActive ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' : 'text-dark-bg/80 dark:text-light-bg/80 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5'}`}
                                >
                                    <Link2 size={13} className="shrink-0 opacity-60" />
                                    <span className="truncate">{t}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
        const v = e.target.value;
        titleRef.current = v;
        setTitle(v);
        setSaving(true);
    }
}
