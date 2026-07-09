import { X, Moon, Sun, Monitor, Palette, Settings2, Info, FolderOpen, HardDrive } from 'lucide-react';
import { useState, useEffect } from 'react';
import { APP_VERSION } from '../lib/constants';
import { isFileSystemSupported, openVaultPicker, reloadTree } from '../lib/vault';
import { useAppStore } from '../store';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    theme: 'light' | 'dark' | 'system';
    setTheme: (theme: 'light' | 'dark' | 'system') => void;
    initialTab?: 'general' | 'appearance';
}

export default function SettingsModal({ isOpen, onClose, theme, setTheme, initialTab = 'general' }: SettingsModalProps) {
    const { setTree } = useAppStore();
    const [activeTab, setActiveTab] = useState<'general' | 'appearance'>(initialTab);
    const [picking, setPicking] = useState(false);

    useEffect(() => {
        if (isOpen) setActiveTab(initialTab);
    }, [isOpen, initialTab]);

    const handleChangeFolder = async () => {
        setPicking(true);
        try {
            const handle = await openVaultPicker();
            if (handle) {
                setTree(await reloadTree());
                onClose();
            }
        } finally {
            setPicking(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fadein">
            <div
                className="absolute inset-0 bg-dark-bg/50 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />
            <div className="relative w-full max-w-2xl bg-light-bg dark:bg-dark-bg rounded-lg shadow-2xl border border-light-ui dark:border-dark-ui flex flex-col md:flex-row overflow-hidden animate-scalein">
                <div className="w-full md:w-56 bg-light-ui/40 dark:bg-dark-ui/40 border-b md:border-b-0 md:border-r border-light-ui dark:border-dark-ui flex flex-col shrink-0 flex-none">
                    <div className="p-4 border-b border-light-ui dark:border-dark-ui hidden md:block">
                        <h2 className="font-semibold text-lg text-dark-bg dark:text-light-bg">Settings</h2>
                    </div>
                    <nav className="flex md:flex-col p-2 md:p-3 gap-1 overflow-x-auto md:overflow-visible">
                        <button onClick={() => setActiveTab('general')} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'general' ? 'bg-light-bg dark:bg-dark-bg text-dark-bg dark:text-light-bg shadow-sm' : 'text-dark-bg/70 dark:text-light-bg/70 hover:bg-light-bg/50 dark:hover:bg-dark-bg/50'}`}>
                            <Settings2 size={16} /> General
                        </button>
                        <button onClick={() => setActiveTab('appearance')} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'appearance' ? 'bg-light-bg dark:bg-dark-bg text-dark-bg dark:text-light-bg shadow-sm' : 'text-dark-bg/70 dark:text-light-bg/70 hover:bg-light-bg/50 dark:hover:bg-dark-bg/50'}`}>
                            <Palette size={16} /> Appearance
                        </button>
                    </nav>
                    <div className="mt-auto p-4 space-y-3">
                        <a href="https://github.com/CubeSeven/keim/issues" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-500/5 hover:bg-red-500/10 transition-colors border border-red-500/10">
                            <Info size={14} /> Report a Bug
                        </a>
                        <a href="https://github.com/CubeSeven/keim" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider text-dark-bg/60 dark:text-light-bg/60 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 transition-colors border border-transparent hover:border-dark-bg/10 dark:hover:border-light-bg/10">
                            GitHub Project
                        </a>
                        <p className="text-[10px] opacity-30 text-center font-mono uppercase tracking-widest">v{APP_VERSION}</p>
                    </div>
                </div>

                <div className="flex-1 flex flex-col relative overflow-hidden bg-light-bg dark:bg-dark-bg">
                    <button onClick={onClose} className="absolute top-4 right-4 z-10 p-1.5 hover:bg-light-ui dark:hover:bg-dark-ui rounded-lg text-dark-bg dark:text-light-bg transition-colors">
                        <X size={20} />
                    </button>
                    <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 text-dark-bg dark:text-light-bg">
                        {activeTab === 'general' && (
                            <div className="space-y-8 animate-fadein">
                                <div className="pb-2 border-b border-light-ui dark:border-dark-ui">
                                    <h3 className="text-xl font-semibold">General Options</h3>
                                </div>
                                <div className="space-y-4">
                                    <label className="text-sm font-bold opacity-50 uppercase tracking-widest">Storage</label>
                                    <div className="relative p-5 rounded-2xl border-2 border-dark-bg/20 dark:border-light-bg/20 bg-dark-bg/5 dark:bg-light-bg/5 shadow-md shadow-dark-bg/10 dark:shadow-light-bg/10 flex flex-col gap-4">
                                        <div className="flex items-center justify-between">
                                            <div className="p-2.5 rounded-xl bg-dark-bg dark:bg-light-bg text-light-bg dark:text-dark-bg">
                                                <HardDrive size={22} />
                                            </div>
                                            <div className="flex items-center gap-1.5 text-dark-bg dark:text-light-bg font-bold text-[10px] uppercase tracking-wider bg-dark-bg/5 dark:bg-light-bg/10 px-2 py-1 rounded-full border border-dark-bg/20 dark:border-light-bg/20">
                                                Active
                                            </div>
                                        </div>
                                        <div className="space-y-1.5 flex-1">
                                            <h4 className="font-bold text-base leading-none">Local Disk (Vault)</h4>
                                            <p className="text-xs opacity-60 leading-relaxed">
                                                Your notes are saved as real <code className="bg-dark-bg/5 dark:bg-light-bg/10 px-1 rounded font-mono">.md</code> files in the folder you chose.
                                            </p>
                                            <p className="text-[11px] leading-relaxed text-indigo-600/80 dark:text-indigo-400/80 flex items-start gap-1.5 pt-0.5">
                                                <span className="font-semibold shrink-0">Sync:</span>
                                                <span>To sync across devices, pick a vault folder inside your Google Drive, Dropbox, iCloud, or OneDrive folder — your notes sync automatically with no setup in Keim.</span>
                                            </p>
                                        </div>
                                        {isFileSystemSupported() && (
                                            <button
                                                disabled={picking}
                                                onClick={handleChangeFolder}
                                                className="w-full py-2.5 rounded-xl bg-dark-bg dark:bg-light-bg text-light-bg dark:text-dark-bg text-sm font-bold transition-all shadow-lg hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
                                            >
                                                <FolderOpen size={16} /> {picking ? 'Choosing…' : 'Change Folder'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'appearance' && (
                            <div className="space-y-8 animate-fadein">
                                <div className="pb-2 border-b border-light-ui dark:border-dark-ui">
                                    <h3 className="text-xl font-semibold">Appearance</h3>
                                </div>
                                <div className="space-y-4">
                                    <label className="text-sm font-bold opacity-50 uppercase tracking-widest">Theme</label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {(['light', 'dark', 'system'] as const).map((t) => (
                                            <button
                                                key={t}
                                                onClick={() => setTheme(t)}
                                                className={`flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all ${theme === t ? 'border-indigo-500 bg-indigo-500/5' : 'border-light-ui dark:border-dark-ui hover:border-dark-bg/30 dark:hover:border-light-bg/30'}`}
                                            >
                                                {t === 'light' && <Sun size={20} />}
                                                {t === 'dark' && <Moon size={20} />}
                                                {t === 'system' && <Monitor size={20} />}
                                                <span className="text-xs font-semibold capitalize">{t}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
