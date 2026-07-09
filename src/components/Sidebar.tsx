import { useMemo } from 'react';
import { useAppStore } from '../store';
import { type VaultFolder, type VaultNote } from '../lib/vault';
import { Settings, HardDrive, Check } from 'lucide-react';
import { buildSidebarTree, type SidebarNodeData } from './SidebarNode';
import Node from './SidebarNode';
import { mirage } from 'ldrs';
mirage.register();

interface SidebarProps {
    onOpenSettings: () => void;
}

export default function Sidebar({ onOpenSettings }: SidebarProps) {
    const { isSidebarOpen, setSidebarOpen, tree } = useAppStore();

    const root = useMemo<SidebarNodeData[]>(
        () => buildSidebarTree(tree.folders as VaultFolder[], tree.notes as VaultNote[]),
        [tree]
    );

    return (
        <>
            {isSidebarOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-dark-bg/50 backdrop-blur-sm z-40 transition-opacity duration-200"
                    onClick={() => setSidebarOpen(false)}
                    aria-hidden="true"
                />
            )}

            <aside
                className="fixed inset-y-0 left-0 z-50 h-full w-64 bg-light-ui/70 dark:bg-dark-ui/70 backdrop-blur-xl border-r border-black/5 dark:border-white/5 flex flex-col shadow-2xl md:shadow-none transition-transform duration-300 ease-in-out"
                style={{ transform: isSidebarOpen ? 'translateX(0)' : 'translateX(-100%)' }}
            >
                <div className="flex flex-col h-full">
                    <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col px-2" style={{ paddingTop: 'calc(4.5rem + var(--spacing-safe-top, 0px))', paddingBottom: '0.5rem' }}>
                        <div className="flex-1 min-h-full cursor-default" onClick={(e) => { if (e.target === e.currentTarget) useAppStore.getState().setSelectedNotePath(null); }}>
                            {root.map(node => (
                                <div key={node.path}>
                                    <Node node={node} level={0} tree={root} />
                                </div>
                            ))}
                            {root.length === 0 && (
                                <p className="px-3 py-6 text-center text-xs text-dark-bg/40 dark:text-light-bg/40">
                                    No notes yet. Create your first note.
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="mx-2 mb-2 p-1.5 shrink-0 flex items-center justify-between bg-white/50 dark:bg-white/10 backdrop-blur-md rounded-xl border border-black/5 dark:border-white/5 shadow-sm ring-1 ring-black/5 dark:ring-white/10" style={{ marginBottom: 'calc(0.5rem + var(--spacing-safe-bottom, 0px))' }}>
                        <div className="flex items-center gap-1">
                            <button onClick={onOpenSettings} className="p-1.5 rounded-lg hover:bg-dark-bg/10 dark:hover:bg-light-bg/10 text-dark-bg/70 dark:text-light-bg/70 transition-colors shrink-0" title="Settings">
                                <Settings size={16} strokeWidth={1.5} />
                            </button>
                            <div className="flex items-center justify-center p-1.5 rounded-lg text-dark-bg/40 dark:text-light-bg/40">
                                <HardDrive size={16} strokeWidth={1.5} />
                            </div>
                        </div>

                        <SaveStatusBadge />
                    </div>
                </div>
            </aside>
        </>
    );
}

function SaveStatusBadge() {
    const saving = useAppStore(s => s.saving);
    const lastSavedTime = useAppStore(s => s.lastSavedTime);

    const timeString = lastSavedTime
        ? new Date(lastSavedTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

    if (saving) {
        return (
            <div className="flex items-center justify-center px-1 h-[28px] md:h-[26px] text-dark-bg/60 dark:text-light-bg/60" title="Saving…">
                <l-mirage size="32" speed="2.5" color="currentColor" />
            </div>
        );
    }

    return (
        <div className="flex items-center h-[28px] md:h-[26px] px-2 gap-1.5 rounded-lg text-dark-bg/50 dark:text-light-bg/50" title="Saved">
            <Check size={15} strokeWidth={2.5} className="opacity-70" />
            {timeString && <span className="text-[10px] font-medium opacity-80">{timeString}</span>}
        </div>
    );
}
