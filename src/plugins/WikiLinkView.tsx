import { useNodeViewContext } from '@prosemirror-adapter/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { triggerAutoSync } from '../lib/sync';
import { getStorageMode, writeNoteToVault, notePathFromTitle } from '../lib/vault';

import { Link, Link2Off } from 'lucide-react';

export const WikiLinkView = ({ onSelectNote }: { onSelectNote: (id: number) => void }) => {
    const { node } = useNodeViewContext();
    const title = node.attrs.title;
    
    const note = useLiveQuery(async () => {
        const items = await db.items.where({ title }).toArray();
        return items.find(i => !i.isDeleted);
    }, [title]);

    const handleClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (note) {
            onSelectNote(note.id!);
        } else {
            // Create ghost note
            const { addItem } = await import('../lib/db');
            
            const newId = await addItem({ 
                title, 
                type: 'note',
                parentId: 0 
            }, '') as number;

            if (getStorageMode() === 'vault') {
                try {
                    const notePath = notePathFromTitle(title, '');
                    await writeNoteToVault(notePath, '');
                } catch (err) {
                    console.error('Failed to create vault file for wiki-link', err);
                }
            }

            triggerAutoSync();
            if (newId) onSelectNote(newId);
        }
    };

    return (
        <span 
            className={`wiki-link-chip inline-flex items-center gap-1 cursor-pointer rounded transition-colors ${
                note 
                ? 'text-indigo-600 dark:text-zinc-100 dark:bg-zinc-800/40 dark:border dark:border-zinc-700/50 hover:bg-indigo-500/10 dark:hover:bg-zinc-700/60' 
                : 'text-dark-bg/40 dark:text-light-bg/40 italic hover:bg-dark-bg/5 dark:hover:bg-light-bg/5'
            }`}
            data-title={title}
            onClick={handleClick}
            title={note ? `Open: ${title}` : `Create: ${title}`}
        >
            {note ? <Link size={12} className="opacity-50" /> : <Link2Off size={12} className="opacity-30" />}
            <span className="font-medium">{title}</span>
        </span>
    );
};
