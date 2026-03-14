import { Plus, Folder, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface NavigationDockProps {
    onAddNote: () => void;
    onAddFolder: () => void;
    isSidebarOpen: boolean;
}

export default function NavigationDock({ onAddNote, onAddFolder, isSidebarOpen }: NavigationDockProps) {
    const handleSearch = () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', altKey: true }));
    };

    const btnClass =
        'flex flex-col items-center justify-center p-3 text-dark-bg/60 dark:text-light-bg/60 hover:text-dark-bg dark:hover:text-light-bg transition-colors';

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
        </motion.div>
        </AnimatePresence>
    );
}
