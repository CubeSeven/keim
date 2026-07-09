import { Plus, Folder } from 'lucide-react';

interface NavigationDockProps {
    onAddNote: () => void;
    onAddFolder: () => void;
    isSidebarOpen: boolean;
}

export default function NavigationDock({ onAddNote, onAddFolder, isSidebarOpen }: NavigationDockProps) {
    const btnClass =
        'flex flex-col items-center justify-center p-3 text-dark-bg/60 dark:text-light-bg/60 hover:text-dark-bg dark:hover:text-light-bg transition-colors active:scale-90';

    return (
        <div
            className={`
                z-50 flex items-center justify-center border border-black/5 dark:border-white/5 ring-1 ring-black/5 dark:ring-white/10 rounded-full bg-white/60 dark:bg-white/5 backdrop-blur-xl shadow-2xl transition-all duration-300 ease-out
                ${isSidebarOpen
                    ? 'fixed md:absolute right-4 bottom-6 md:left-1/2 md:-translate-x-1/2 md:right-auto flex-col md:flex-row gap-2 md:gap-1 px-2 py-4 md:px-4 md:py-1'
                    : 'fixed md:absolute left-1/2 -translate-x-1/2 bottom-6 flex-row gap-1 px-4 py-1'}
            `}
        >
            <button onClick={onAddNote} className={btnClass} title="New Note (Alt+N)">
                <Plus size={20} strokeWidth={1.5} />
            </button>
            <button onClick={onAddFolder} className={btnClass} title="New Folder (Alt+F)">
                <Folder size={20} strokeWidth={1.5} />
            </button>
        </div>
    );
}
