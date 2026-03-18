import { useEffect, useState, useRef } from 'react';
import { db } from '../lib/db';
import { parseYamlFrontmatter } from '../lib/smartProps';

export const LinkPreview = () => {
    const [preview, setPreview] = useState<{ x: number, y: number, title: string, content: string } | null>(null);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        const handleMouseOver = async (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const wikiLink = target.closest('.wiki-link-chip');
            
            if (wikiLink) {
                const title = (wikiLink as HTMLElement).dataset.title;
                if (!title) return;

                if (timerRef.current) window.clearTimeout(timerRef.current);
                timerRef.current = window.setTimeout(async () => {
                    const items = await db.items.where({ title }).toArray();
                    const note = items.find(i => !i.isDeleted);
                    if (note) {
                        const contentObj = await db.contents.get(note.id!);
                        const body = contentObj ? parseYamlFrontmatter(contentObj.content).body : '';
                        
                        // Calculate position
                        const rect = wikiLink.getBoundingClientRect();
                        const x = rect.left;
                        const y = rect.bottom + 8;

                        setPreview({
                            x,
                            y,
                            title,
                            content: body.trim().slice(0, 300).replace(/[\r\n]+/g, ' ') + (body.length > 300 ? '...' : '')
                        });
                    }
                }, 500);
            }
        };

        const handleMouseOut = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const wikiLink = target.closest('.wiki-link-chip');
            if (wikiLink) {
                if (timerRef.current) window.clearTimeout(timerRef.current);
                setPreview(null);
            }
        };

        document.addEventListener('mouseover', handleMouseOver);
        document.addEventListener('mouseout', handleMouseOut);
        return () => {
            document.removeEventListener('mouseover', handleMouseOver);
            document.removeEventListener('mouseout', handleMouseOut);
        };
    }, []);

    if (!preview) return null;

    return (
        <div 
            className="fixed z-[100] w-72 p-4 rounded-xl bg-white/95 dark:bg-neutral-900/95 border border-black/5 dark:border-white/5 shadow-2xl backdrop-blur-md pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200"
            style={{ left: Math.min(preview.x, window.innerWidth - 300), top: preview.y }}
        >
            <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-indigo-500" />
                <h4 className="text-[13px] font-bold text-dark-bg dark:text-light-bg truncate">{preview.title}</h4>
            </div>
            <div className="text-[11px] text-dark-bg/70 dark:text-light-bg/60 leading-relaxed font-normal">
                {preview.content || <span className="italic opacity-40">Empty note contents</span>}
            </div>
            <div className="mt-3 pt-2 border-t border-black/5 dark:border-white/5 flex justify-between items-center">
                <span className="text-[9px] uppercase tracking-wider font-bold opacity-30">Wiki Preview</span>
                <span className="text-[9px] opacity-20">Click to open</span>
            </div>
        </div>
    );
};
