import { Cloud, Loader2 } from 'lucide-react';
import type { SyncProgress } from '../lib/sync';

interface SyncProgressModalProps {
    progress: SyncProgress | null;
    onClose: () => void;
}

export default function SyncProgressModal({ progress, onClose }: SyncProgressModalProps) {
    if (!progress) return null;

    const percent = Math.round((progress.current / progress.total) * 100);

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-dark-bg/60 backdrop-blur-md" onClick={onClose} />

            <div className="relative w-full max-w-sm bg-light-bg dark:bg-dark-bg rounded-2xl shadow-2xl border border-light-ui dark:border-dark-ui overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6 flex flex-col items-center text-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                        <Cloud size={32} className="animate-pulse" />
                    </div>

                    <div className="space-y-1">
                        <h3 className="text-lg font-bold text-dark-bg dark:text-light-bg">Synchronizing Cloud</h3>
                        <p className="text-sm text-dark-bg/60 dark:text-light-bg/60">{progress.status}</p>
                    </div>

                    <div className="w-full space-y-2 mt-2">
                        <div className="h-2 w-full bg-dark-bg/5 dark:bg-light-bg/5 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-indigo-500 transition-all duration-300 ease-out"
                                style={{ width: `${percent}%` }}
                            />
                        </div>
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest opacity-40">
                            <span>{progress.current} / {progress.total} Items</span>
                            <span>{percent}%</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2 py-2 px-4 rounded-full bg-dark-bg/5 dark:bg-light-bg/5 text-xs font-medium text-dark-bg/70 dark:text-light-bg/70">
                        <Loader2 size={14} className="animate-spin text-indigo-500" />
                        Please keep the app open...
                    </div>
                </div>

                <div className="border-t border-light-ui dark:border-dark-ui p-3 bg-light-ui/30 dark:bg-dark-ui/30 flex justify-center">
                    <button
                        onClick={onClose}
                        className="text-xs font-semibold uppercase tracking-widest py-1.5 px-4 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 rounded-lg transition-colors opacity-50 hover:opacity-100"
                    >
                        Hide Window
                    </button>
                </div>
            </div>
        </div>
    );
}
