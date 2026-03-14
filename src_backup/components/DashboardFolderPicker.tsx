import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { Database, X, FolderOpen, ChevronRight } from 'lucide-react';

interface SmartFolder { id: number; title: string; }

interface DashboardFolderPickerProps {
    onPick: (folderName: string) => void;
    onClose: () => void;
}

export function DashboardFolderPicker({ onPick, onClose }: DashboardFolderPickerProps) {
    const [smartFolders, setSmartFolders] = useState<SmartFolder[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            const schemas = await db.smartSchemas.toArray();
            const folders: SmartFolder[] = [];
            for (const s of schemas) {
                const item = await db.items.get(s.folderId);
                if (item && !item.isDeleted) folders.push({ id: item.id!, title: item.title });
            }
            setSmartFolders(folders);
            setLoading(false);
        }
        load();
    }, []);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="w-72 overflow-hidden rounded-xl shadow-2xl border border-black/8 dark:border-white/10
                            bg-light-bg/90 dark:bg-[#1a1a1f]/90 backdrop-blur-xl
                            animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3.5 border-b border-black/5 dark:border-white/8">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-indigo-500/15 flex items-center justify-center">
                            <Database size={13} className="text-indigo-500" />
                        </div>
                        <span className="text-sm font-semibold text-dark-bg dark:text-light-bg">Insert Dashboard</span>
                    </div>
                    <button onClick={onClose}
                        className="w-6 h-6 flex items-center justify-center rounded-md text-dark-bg/40 dark:text-light-bg/40 hover:bg-dark-bg/8 dark:hover:bg-light-bg/8 transition-colors">
                        <X size={14} />
                    </button>
                </div>

                {/* Subtitle */}
                <p className="px-4 pt-3 pb-1 text-xs text-dark-bg/50 dark:text-light-bg/40">Choose a Smart Folder to display:</p>

                {/* List */}
                <div className="px-2 pb-2 max-h-60 overflow-y-auto">
                    {loading ? (
                        <div className="py-8 text-center text-xs text-dark-bg/40 dark:text-light-bg/40">Loading…</div>
                    ) : smartFolders.length === 0 ? (
                        <div className="py-6 px-3 text-center text-xs text-dark-bg/50 dark:text-light-bg/40 leading-relaxed">
                            No Smart Folders yet.<br />
                            <span className="opacity-70">Right-click a folder → <strong>Make Smart</strong></span>
                        </div>
                    ) : (
                        <ul className="space-y-0.5 pt-1">
                            {smartFolders.map(f => (
                                <li key={f.id}>
                                    <button onClick={() => onPick(f.title)}
                                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left
                                                   text-dark-bg dark:text-light-bg
                                                   hover:bg-indigo-500/10 dark:hover:bg-indigo-400/10
                                                   hover:text-indigo-600 dark:hover:text-indigo-400
                                                   transition-colors group">
                                        <FolderOpen size={14} className="text-indigo-400 shrink-0" />
                                        <span className="flex-1 truncate font-medium">{f.title}</span>
                                        <ChevronRight size={13} className="opacity-0 group-hover:opacity-40 transition-opacity shrink-0" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
