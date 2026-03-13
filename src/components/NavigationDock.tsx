import { Plus, Folder, Search } from 'lucide-react';

interface NavigationDockProps {
    onAddNote: () => void;
    onAddFolder: () => void;
}

export function NavigationDock({ onAddNote, onAddFolder }: NavigationDockProps) {
    const handleSearch = () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', altKey: true }));
    };

    const btnClass =
        'flex flex-col items-center justify-center p-3 text-dark-bg/60 dark:text-light-bg/60 hover:text-dark-bg dark:hover:text-light-bg active:scale-95 transition-all';

    return (
        <div
            className="absolute left-1/2 -translate-x-1/2 z-50 flex items-center justify-center gap-1 px-4 py-1 bg-white/60 dark:bg-white/5 backdrop-blur-xl shadow-2xl border border-black/5 dark:border-white/5 ring-1 ring-black/5 dark:ring-white/10 rounded-full transition-all duration-300 ease-in-out"
            style={{
                bottom: '1.5rem'
            }}
        >
            <button onClick={handleSearch} className={btnClass} title="Search Notes (Alt+K)">
                <Search size={20} strokeWidth={1.5} />
            </button>

            <div className="w-px h-6 bg-dark-bg/10 dark:bg-light-bg/10 mx-1 opacity-50"></div>

            <button onClick={onAddNote} className={btnClass} title="New Note (Alt+N)">
                <Plus size={20} strokeWidth={1.5} />
            </button>

            <button onClick={onAddFolder} className={btnClass} title="New Folder (Alt+F)">
                <Folder size={20} strokeWidth={1.5} />
            </button>
        </div>
    );
}

export default NavigationDock;
