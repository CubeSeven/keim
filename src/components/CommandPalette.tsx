import { useState, useEffect, useCallback } from 'react';
import { Command } from 'cmdk';
import { Search, FileText, Folder } from 'lucide-react';
import { miniSearch, type SearchResult } from '../lib/search';
import { db, getFullPath } from '../lib/db';

interface CommandPaletteProps {
    onSelectNote: (id: number) => void;
}

export function CommandPalette({ onSelectNote }: CommandPaletteProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<(SearchResult & { fullPath: string, icon?: string, tags?: string[] })[]>([]);

    // Toggle the menu when ⌘K is pressed
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'k' && e.ctrlKey) {
                e.preventDefault();
                setOpen((open) => !open);
            }
        };

        document.addEventListener('keydown', down);
        return () => document.removeEventListener('keydown', down);
    }, []);

    // Run search when query changes
    useEffect(() => {
        if (query.trim().length === 0) {
            const timer = setTimeout(() => setResults([]), 0);
            return () => clearTimeout(timer);
        }

        const performSearch = async () => {
            try {
                // 1. Query minisearch
                const rawResults = miniSearch.search(query, {
                    fields: ['title', 'content', 'tags'], // Search these fields
                    boost: { title: 2, tags: 1.5 },
                    fuzzy: 0.2, // typo tolerance
                    prefix: true, // partial matching
                }) as unknown as SearchResult[];

                // 2. Hydrate with paths (take top 15 results for snappiness)
                const topResults = rawResults.slice(0, 15);
                if (topResults.length === 0) {
                    setResults([]);
                    return;
                }

                const allItems = await db.items.toArray();
                const hydratedResults = topResults.map(res => {
                    const originalItem = allItems.find(i => i.id === res.id);
                    return {
                        ...res,
                        icon: originalItem?.icon,
                        tags: originalItem?.tags,
                        fullPath: getFullPath(res.id, allItems) || 'Root'
                    };
                });

                setResults(hydratedResults);
            } catch (e) {
                console.error("Search failed:", e);
            }
        };

        performSearch();
    }, [query]);

    // Handle Selection
    const handleSelect = useCallback((noteId: number) => {
        setOpen(false);
        onSelectNote(noteId);
        // Tiny delay to let the modal close smoothly before wiping the input
        setTimeout(() => setQuery(''), 150);
    }, [onSelectNote]);

    return (
        <Command.Dialog
            open={open}
            onOpenChange={setOpen}
            shouldFilter={false} // We rely entirely on MiniSearch for filtering/ranking, not cmdk's built-in string matcher
            label="Universal Search"
            className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] sm:pt-[20vh] bg-black/40 backdrop-blur-sm transition-all"
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
            <div className="w-[90vw] max-w-[600px] overflow-hidden rounded-xl bg-light-bg/85 dark:bg-[#1a1a1f]/80 backdrop-blur-xl shadow-2xl border border-black/5 dark:border-white/10 ring-1 ring-black/5 dark:ring-white/10 flex flex-col animate-in fade-in zoom-in-95 duration-200">

                {/* Header / Input */}
                <div className="flex items-center border-b border-black/5 dark:border-white/10 px-4 py-3 bg-transparent relative">
                    <Search className="mr-3 h-5 w-5 text-dark-bg/40 dark:text-light-bg/40" />
                    <Command.Input
                        value={query}
                        onValueChange={setQuery}
                        placeholder="Search notes..."
                        className="flex-1 bg-transparent text-lg text-dark-bg dark:text-light-bg outline-none placeholder:text-dark-bg/40 dark:placeholder:text-light-bg/40 border-none ring-0 w-full"
                        autoFocus
                    />
                    <div className="flex items-center gap-1">
                        <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-light-border dark:border-dark-border bg-light-bg dark:bg-dark-bg px-1.5 font-mono text-[10px] font-medium text-dark-bg/40 dark:text-light-bg/40">
                            esc
                        </kbd>
                    </div>
                </div>

                {/* Results Body */}
                <Command.List className="max-h-[300px] overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-light-border dark:scrollbar-thumb-dark-border">
                    {query.length > 0 && results.length === 0 && (
                        <div className="py-10 text-center text-sm text-dark-bg/50 dark:text-light-bg/50">
                            No notes found for <span className="font-medium text-dark-bg dark:text-light-bg">"{query}"</span>.
                        </div>
                    )}

                    {results.length > 0 && (
                        <Command.Group heading="Notes">
                            {results.map((result) => (
                                <Command.Item
                                    key={result.id}
                                    value={result.id.toString()} // crucial for cmdk internal tracking
                                    onSelect={() => handleSelect(result.id)}
                                    className="group flex flex-col gap-1 rounded-lg px-4 py-2 text-sm text-dark-bg dark:text-light-bg cursor-default select-none transition-colors aria-selected:bg-indigo-50 dark:aria-selected:bg-indigo-500/10 aria-selected:text-indigo-600 dark:aria-selected:text-indigo-400 data-[selected=true]:bg-indigo-50 dark:data-[selected=true]:bg-indigo-500/10 data-[selected=true]:text-indigo-600 dark:data-[selected=true]:text-indigo-400"
                                >
                                    <div className="flex items-center font-medium">
                                        {result.icon ? (
                                            <span className="mr-2 flex-shrink-0 text-base leading-none">{result.icon}</span>
                                        ) : (
                                            <FileText className="mr-2 h-4 w-4 opacity-50 flex-shrink-0" />
                                        )}
                                        <span className="truncate">{result.title}</span>
                                    </div>
                                    <div className="flex items-center flex-wrap text-xs text-dark-bg/50 dark:text-light-bg/50 aria-selected:text-indigo-500/70 dark:aria-selected:text-indigo-400/70 pl-6 gap-2">
                                        <div className="flex items-center">
                                            <Folder className="mr-1.5 h-3 w-3 opacity-50 flex-shrink-0" />
                                            <span className="truncate">{result.fullPath}</span>
                                        </div>
                                        {result.tags && result.tags.length > 0 && (
                                            <div className="flex items-center gap-1 opacity-80 flex-wrap">
                                                {result.tags.map(t => (
                                                    <span key={t} className="px-1.5 py-0.5 rounded bg-dark-bg/5 dark:bg-light-bg/5 text-[10px] font-medium border border-dark-bg/5 dark:border-light-bg/5 text-dark-bg dark:text-light-bg truncate max-w-[80px]">#{t}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}

                </Command.List>
            </div>
        </Command.Dialog>
    );
}
