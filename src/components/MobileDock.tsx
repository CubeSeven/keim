import { Plus, Folder, Search } from 'lucide-react';

interface MobileDockProps {
    onAddNote: () => void;
    onAddFolder: () => void;
}

export function MobileDock({ onAddNote, onAddFolder }: MobileDockProps) {
    const handleSearch = () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    };

    const btnClass =
        'flex flex-col items-center justify-center p-2.5 text-dark-bg/70 dark:text-light-bg/70 hover:text-indigo-500 dark:hover:text-indigo-400 active:scale-95 transition-all';

    return (
        <div
            className="md:hidden fixed left-1/2 -translate-x-1/2 z-50 flex items-center justify-center gap-2 px-5 py-1.5 bg-light-ui/90 dark:bg-dark-ui/90 backdrop-blur-md shadow-xl border border-dark-bg/10 dark:border-light-bg/10 rounded-full"
            style={{
                bottom: 'calc(1.5rem + var(--spacing-safe-bottom, 0px))'
            }}
        >
            <button onClick={handleSearch} className={btnClass} title="Search Notes">
                <Search size={22} />
            </button>

            <div className="w-px h-6 bg-dark-bg/10 dark:bg-light-bg/10 mx-1"></div>

            <button onClick={onAddNote} className={btnClass} title="New Note">
                <Plus size={22} />
            </button>

            <button onClick={onAddFolder} className={btnClass} title="New Folder">
                <Folder size={22} />
            </button>
        </div>
    );
}

export default MobileDock;
