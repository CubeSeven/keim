import { X, Moon, Sun, CloudSync, Monitor } from 'lucide-react';
import { syncNotesWithDrive } from '../lib/sync';
import { useState } from 'react';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    theme: 'light' | 'dark' | 'system';
    setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export default function SettingsModal({ isOpen, onClose, theme, setTheme }: SettingsModalProps) {
    const [syncing, setSyncing] = useState(false);

    if (!isOpen) return null;

    const handleSync = async () => {
        setSyncing(true);
        try {
            await syncNotesWithDrive();
            alert('Sync successful!');
        } catch (e) {
            alert('Sync failed - see console for details.');
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <div
                className="absolute inset-0 bg-dark-bg/50 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />
            <div className="relative w-full max-w-md bg-light-bg dark:bg-dark-bg rounded-xl shadow-2xl border border-light-ui dark:border-dark-ui flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-light-ui dark:border-dark-ui bg-light-ui dark:bg-dark-ui">
                    <h2 className="font-semibold text-lg text-dark-bg dark:text-light-bg">Settings</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-light-bg dark:hover:bg-dark-bg rounded-lg text-dark-bg dark:text-light-bg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-8 text-dark-bg dark:text-light-bg">
                    {/* Theme Section */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium opacity-70 uppercase tracking-wider">Appearance</label>
                        <div className="grid grid-cols-3 gap-2 bg-light-ui dark:bg-dark-ui p-1 rounded-lg">
                            {(
                                [
                                    { id: 'light', label: 'Light', Icon: Sun },
                                    { id: 'dark', label: 'Dark', Icon: Moon },
                                    { id: 'system', label: 'System', Icon: Monitor },
                                ] as const
                            ).map(({ id, label, Icon }) => (
                                <button
                                    key={id}
                                    onClick={() => setTheme(id)}
                                    className={`flex flex-col items-center justify-center p-3 rounded-md transition-all ${theme === id ? 'bg-light-bg dark:bg-dark-bg shadow-sm' : 'hover:bg-light-bg/50 dark:hover:bg-dark-bg/50 opacity-60 hover:opacity-100'}`}
                                >
                                    <Icon size={20} className="mb-2" />
                                    <span className="text-xs font-medium">{label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Sync Section */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium opacity-70 uppercase tracking-wider">Google Drive</label>
                        <div className="flex items-center justify-between p-4 bg-light-ui dark:bg-dark-ui rounded-lg">
                            <div>
                                <h3 className="font-medium">Cloud Sync</h3>
                                <p className="text-xs opacity-70 mt-0.5">Backup notes to your personal Drive.</p>
                            </div>
                            <button
                                onClick={handleSync}
                                disabled={syncing}
                                className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-all ${syncing ? 'opacity-50 cursor-not-allowed bg-dark-bg/10 dark:bg-light-bg/10' : 'bg-dark-bg text-light-bg dark:bg-light-bg dark:text-dark-bg hover:opacity-90'}`}
                            >
                                <CloudSync size={16} className={syncing ? 'animate-spin' : ''} />
                                {syncing ? 'Syncing...' : 'Sync Now'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
