import React from 'react';
import { Plus, Folder, Search, Cloud, Check, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { mirage } from 'ldrs';
mirage.register();
import type { SyncStatus } from '../App';

interface NavigationDockProps {
    onAddNote: () => void;
    onAddFolder: () => void;
    isSidebarOpen: boolean;
    syncStatus?: SyncStatus;
    onSync?: () => void;
    showSlashButton?: boolean;
}

function DockSyncIndicator({ status, onSync }: { status: SyncStatus; onSync?: () => void }) {
    if (status === 'disconnected' || status === 'idle') return null;

    const handleClick = () => {
        if (status !== 'syncing') onSync?.();
    };

    return (
        <AnimatePresence mode="wait">
            <motion.button
                key={status}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.2 }}
                onClick={handleClick}
                disabled={status === 'syncing'}
                title={status === 'syncing' ? 'Syncing…' : status === 'synced' ? 'Synced' : 'Sync error — tap to retry'}
                className="flex flex-col items-center justify-center p-3 transition-colors"
            >
                {status === 'syncing' && (
                    <span className="flex items-center justify-center h-5">
                        <l-mirage size="32" speed="2.5" color="currentColor" />
                    </span>
                )}
                {status === 'synced' && (
                    <Check size={18} strokeWidth={2.5} className="text-dark-bg dark:text-light-bg" />
                )}
                {status === 'error' && (
                    <AlertCircle size={18} strokeWidth={1.5} className="text-dark-bg dark:text-light-bg" />
                )}
                {/* Show cloud icon as base under syncing/error for context */}
                {(status === 'error') && (
                    <Cloud size={10} strokeWidth={1.5} className="text-dark-bg/60 dark:text-light-bg/60 -mt-0.5 opacity-60" />
                )}
            </motion.button>
        </AnimatePresence>
    );
}

export default function NavigationDock({ onAddNote, onAddFolder, isSidebarOpen, syncStatus = 'disconnected', onSync, showSlashButton }: NavigationDockProps) {
    const [isSlashEligible, setIsSlashEligible] = React.useState(false);

    React.useEffect(() => {
        const handleEligibility = (e: Event) => setIsSlashEligible((e as CustomEvent).detail);
        window.addEventListener('keim_slash_eligibility_changed', handleEligibility);
        
        // Reset state when hiding slash button globally (like switching notes)
        if (!showSlashButton) {
            setIsSlashEligible(false);
        }

        return () => window.removeEventListener('keim_slash_eligibility_changed', handleEligibility);
    }, [showSlashButton]);

    const handleSearch = () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', altKey: true }));
    };

    const handleSlash = () => {
        window.dispatchEvent(new CustomEvent('keim_trigger_slash_menu'));
    };

    const btnClass =
        'flex flex-col items-center justify-center p-3 text-dark-bg/60 dark:text-light-bg/60 hover:text-dark-bg dark:hover:text-light-bg transition-colors';

    const showSync = syncStatus !== 'disconnected' && syncStatus !== 'idle';
    // DEBUG LOG
    console.log('[NavigationDock] Rendering with showSlashButton:', showSlashButton);

    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div
                key={String(isSidebarOpen)}
                initial={{ opacity: 0 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeInOut' }}
                className={`
                    z-50 flex items-center justify-center border border-black/5 dark:border-white/5 ring-1 ring-black/5 dark:ring-white/10 rounded-full bg-white/60 dark:bg-white/5 backdrop-blur-xl shadow-2xl
                    ${isSidebarOpen 
                        ? 'fixed md:absolute right-4 bottom-6 md:left-1/2 md:-translate-x-1/2 md:right-auto flex-col md:flex-row gap-2 md:gap-1 px-2 py-4 md:px-4 md:py-1' 
                        : 'fixed md:absolute left-1/2 -translate-x-1/2 bottom-6 flex-row gap-1 px-4 py-1'
                    }
                `}
            >
            <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={handleSearch}
                className={btnClass}
                title="Search Notes (Alt+K)"
            >
                <Search size={20} strokeWidth={1.5} />
            </motion.button>

            <AnimatePresence>
            {showSlashButton && isSlashEligible && (
                <motion.div
                    initial={{ width: 0, opacity: 0, overflow: 'hidden' }}
                    animate={{ width: 'auto', opacity: 1 }}
                    exit={{ width: 0, opacity: 0, overflow: 'hidden' }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="flex items-center justify-center shrink-0"
                >
                    <motion.button
                        whileTap={{ scale: 0.88 }}
                        onClick={handleSlash}
                        className={btnClass}
                        title="Insert command (/)"
                    >
                        <div className="w-5 h-5 flex items-center justify-center font-mono font-bold text-lg opacity-80 leading-none pb-0.5">/</div>
                    </motion.button>
                </motion.div>
            )}
            </AnimatePresence>

            <div className={`
                bg-dark-bg/10 dark:bg-light-bg/10 mx-1 opacity-50
                ${isSidebarOpen ? 'w-6 h-px md:w-px md:h-6' : 'w-px h-6'}
            `}></div>

            <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={onAddNote}
                className={btnClass}
                title="New Note (Alt+N)"
            >
                <Plus size={20} strokeWidth={1.5} />
            </motion.button>

            <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={onAddFolder}
                className={btnClass}
                title="New Folder (Alt+F)"
            >
                <Folder size={20} strokeWidth={1.5} />
            </motion.button>

            {/* Sync indicator — smoothly expands out when visible */}
            <AnimatePresence>
                {showSync && !isSidebarOpen && (
                    <motion.div
                        initial={{ width: 0, opacity: 0, overflow: 'hidden' }}
                        animate={{ width: 'auto', opacity: 1 }}
                        exit={{ width: 0, opacity: 0, overflow: 'hidden' }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="flex items-center justify-center"
                    >
                        <div className="bg-dark-bg/10 dark:bg-light-bg/10 mx-1 opacity-50 w-px h-6"></div>
                        <DockSyncIndicator status={syncStatus} onSync={onSync} />
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
        </AnimatePresence>
    );
}
