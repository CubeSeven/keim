import { useState, useEffect } from 'react';
import type { SmartSchema } from '../lib/db';
import { parseYamlFrontmatter, serializeYamlFrontmatter } from '../lib/smartProps';
import { miniSearch, type SearchResult } from '../lib/search';
import {
    Calendar, Hash, Type, Link as LinkIcon,
    CheckSquare, List, FileText, Search, X, Database
} from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';

interface PropertiesHeaderProps {
    schema: SmartSchema;
    content: string;
    onUpdateContent: (newContent: string) => void;
    onSelectNote?: (id: number) => void;
}

const TYPE_ICON: Record<string, React.ElementType> = {
    date:     Calendar,
    number:   Hash,
    link:     LinkIcon,
    checkbox: CheckSquare,
    select:   List,
    relation: FileText,
    text:     Type,
};

export default function PropertiesHeader({ schema, content, onUpdateContent, onSelectNote }: PropertiesHeaderProps) {
    const [meta, setMeta] = useState<Record<string, string>>({});
    const [relOpen, setRelOpen]     = useState<string | null>(null);
    const [relQuery, setRelQuery]   = useState('');
    const [relResults, setRelResults] = useState<SearchResult[]>([]);

    useEffect(() => {
        setMeta(parseYamlFrontmatter(content).meta);
    }, [content]);

    useEffect(() => {
        if (!relOpen || !relQuery.trim()) { setRelResults([]); return; }
        const r = miniSearch.search(relQuery, { fields: ['title'], prefix: true, fuzzy: 0.2 }) as unknown as SearchResult[];
        setRelResults(r.slice(0, 6));
    }, [relQuery, relOpen]);

    const handleChange = (key: string, value: string) => {
        const newMeta    = { ...meta, [key]: value };
        setMeta(newMeta);
        const parsed    = parseYamlFrontmatter(content);
        onUpdateContent(serializeYamlFrontmatter(newMeta, parsed.body));
    };

    if (!schema.fields.length) return null;

    return (
        <div className="mt-4 mb-8 group relative animate-in fade-in slide-in-from-top-1 duration-250">
            {/* Title bar — absolute positioned above the card to avoid layout shift */}
            <div className="absolute -top-6 left-1 flex items-center gap-2 select-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="w-4 h-4 rounded flex items-center justify-center bg-black/5 dark:bg-white/5">
                    <Database size={10} className="text-dark-bg/40 dark:text-light-bg/40" />
                </div>
                <span className="text-[10px] font-bold text-dark-bg/40 dark:text-light-bg/30 uppercase tracking-widest">Properties</span>
            </div>

            <div className="rounded-xl overflow-hidden
                            border border-black/5 dark:border-white/5
                            bg-white/50 dark:bg-white/10
                            backdrop-blur-md
                            shadow-sm ring-1 ring-black/5 dark:ring-white/10">

                {/* Fields grid */}
                <div className="px-2 py-1.5">
                {schema.fields.map(field => {
                    const val = meta[field.name] || '';
                    const Icon = TYPE_ICON[field.type] ?? Type;

                    let inputEl: React.ReactNode;

                    if (field.type === 'date') {
                        inputEl = (
                            <input type="date" value={val}
                                onChange={e => handleChange(field.name, e.target.value)}
                                className="bg-transparent text-sm outline-none text-dark-bg dark:text-light-bg w-36" />
                        );
                    } else if (field.type === 'number') {
                        inputEl = (
                            <input type="number" value={val} placeholder="Empty"
                                onChange={e => handleChange(field.name, e.target.value)}
                                className="bg-transparent text-sm w-24 outline-none text-dark-bg dark:text-light-bg placeholder-dark-bg/25 dark:placeholder-light-bg/25" />
                        );
                    } else if (field.type === 'checkbox') {
                        inputEl = (
                            <input type="checkbox" checked={val === 'true'}
                                onChange={e => handleChange(field.name, e.target.checked ? 'true' : 'false')}
                                className="w-4 h-4 cursor-pointer accent-indigo-500 rounded" />
                        );
                    } else if (field.type === 'select') {
                        inputEl = (
                            <select value={val}
                                onChange={e => handleChange(field.name, e.target.value)}
                                className="bg-transparent text-sm outline-none text-dark-bg dark:text-light-bg w-32 cursor-pointer appearance-none">
                                <option value="" disabled hidden>Select…</option>
                                {(field.options || []).map(o => (
                                    <option key={o} value={o} className="bg-light-bg dark:bg-dark-bg">{o}</option>
                                ))}
                            </select>
                        );
                    } else if (field.type === 'relation') {
                        const sel = val !== '';
                        inputEl = (
                            <Popover.Root
                                open={relOpen === field.name}
                                onOpenChange={open => {
                                    if (open) { setRelOpen(field.name); setRelQuery(''); }
                                    else setRelOpen(null);
                                }}>
                                <Popover.Trigger asChild>
                                    <button
                                        className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-sm
                                                   border border-black/5 dark:border-white/5
                                                   bg-black/5 dark:bg-white/5
                                                   hover:bg-white/60 dark:hover:bg-white/10
                                                   hover:ring-1 hover:ring-black/5 dark:hover:ring-white/10
                                                   text-dark-bg dark:text-light-bg transition-all"
                                        onClick={e => {
                                            if (sel && onSelectNote) {
                                                e.preventDefault();
                                                const r = miniSearch.search(val, { fields: ['title'] });
                                                if (r.length > 0) onSelectNote(Number(r[0].id));
                                            }
                                        }}>
                                        {sel ? (
                                            <>
                                                <FileText size={11} className="text-dark-bg/40 dark:text-light-bg/40 shrink-0" />
                                                <span className="truncate max-w-[140px] text-dark-bg dark:text-light-bg font-medium">{val}</span>
                                                <div role="button" tabIndex={0}
                                                    className="ml-0.5 p-0.5 rounded hover:bg-red-500/10 transition-colors"
                                                    onClick={e => { e.stopPropagation(); handleChange(field.name, ''); }}>
                                                    <X size={11} className="text-dark-bg/30 hover:text-red-500 transition-colors" />
                                                </div>
                                            </>
                                        ) : (
                                            <span className="text-dark-bg/30 dark:text-light-bg/30 text-xs">Empty relation…</span>
                                        )}
                                    </button>
                                </Popover.Trigger>
                                <Popover.Portal>
                                    <Popover.Content
                                        className="w-60 rounded-lg shadow-2xl z-[200] overflow-hidden
                                                   border border-black/8 dark:border-white/10
                                                   bg-light-bg/90 dark:bg-[#1a1a1f]/90 backdrop-blur-xl
                                                   animate-in fade-in zoom-in-95 duration-150"
                                        sideOffset={6} align="start">
                                        {/* Search box */}
                                        <div className="flex items-center gap-2 mx-2 mt-2 px-3 py-2 rounded-lg
                                                        bg-dark-bg/[0.04] dark:bg-white/[0.05]
                                                        border border-black/6 dark:border-white/8">
                                            <Search size={13} className="text-dark-bg/40 dark:text-light-bg/35 shrink-0" />
                                            <input type="text" value={relQuery}
                                                onChange={e => setRelQuery(e.target.value)}
                                                placeholder="Search notes…"
                                                className="bg-transparent text-sm w-full outline-none text-dark-bg dark:text-light-bg placeholder-dark-bg/30 dark:placeholder-light-bg/25"
                                                autoFocus />
                                        </div>
                                        {/* Results */}
                                        <div className="flex flex-col gap-0.5 px-2 py-2 max-h-52 overflow-y-auto">
                                            {relResults.length === 0 && relQuery.length > 0 && (
                                                <p className="text-center py-4 text-xs text-dark-bg/30 dark:text-light-bg/25">No notes found</p>
                                            )}
                                            {relResults.length === 0 && relQuery.length === 0 && (
                                                <p className="text-center py-4 text-xs text-dark-bg/30 dark:text-light-bg/25">Type to search…</p>
                                            )}
                                            {relResults.map(r => (
                                                <button key={r.id}
                                                    onClick={() => { handleChange(field.name, r.title); setRelOpen(null); }}
                                                    className="flex items-center gap-2.5 px-2.5 py-2 text-sm text-left rounded-lg
                                                               text-dark-bg dark:text-light-bg
                                                               hover:bg-white/50 dark:hover:bg-white/10
                                                               transition-colors">
                                                    <FileText size={13} className="opacity-40 shrink-0" />
                                                    <span className="truncate">{r.title}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </Popover.Content>
                                </Popover.Portal>
                            </Popover.Root>
                        );
                    } else {
                        // text / link
                        inputEl = (
                            <input type={field.type === 'link' ? 'url' : 'text'}
                                value={val} placeholder="Empty"
                                onChange={e => handleChange(field.name, e.target.value)}
                                className="bg-transparent text-sm flex-1 min-w-[120px] outline-none text-dark-bg dark:text-light-bg
                                           placeholder-dark-bg/25 dark:placeholder-light-bg/25" />
                        );
                    }

                    return (
                        <div key={field.name}
                            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg
                                       hover:bg-dark-bg/[0.03] dark:hover:bg-white/[0.03]
                                       transition-colors group/prop">
                            {/* Label */}
                            <div className="flex items-center gap-1.5 w-28 shrink-0 select-none cursor-default
                                            text-dark-bg/40 dark:text-light-bg/35
                                            group-hover/prop:text-dark-bg/60 dark:group-hover/prop:text-light-bg/50 transition-colors">
                                <Icon size={11} />
                                <span className="text-xs truncate">{field.name}</span>
                            </div>
                            {/* Value */}
                            {inputEl}
                        </div>
                    );
                })}
            </div>
        </div>
    </div>
);
}
