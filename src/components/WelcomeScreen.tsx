import { isFileSystemSupported } from '../lib/vault';
import { FolderOpen, Database, Cloud, ArrowRight } from 'lucide-react';

interface WelcomeScreenProps {
    onPickVault: () => void;
    onUseBrowserStorage: () => void;
    isPickingVault: boolean;
}

export default function WelcomeScreen({ onPickVault, onUseBrowserStorage, isPickingVault }: WelcomeScreenProps) {
    const fsSupported = isFileSystemSupported();

    return (
        <div className="flex h-screen w-full items-center justify-center bg-light-bg dark:bg-dark-bg p-6">
            <div className="flex flex-col items-center gap-8 max-w-lg w-full">
                {/* Logo / Brand */}
                <div className="flex flex-col items-center gap-3">
                    <img 
                        src="keim_logo.svg" 
                        alt="Keim Logo" 
                        className="w-20 h-20 rounded-2xl shadow-lg animate-in fade-in zoom-in duration-700"
                    />
                    <h1 className="text-3xl font-bold text-dark-bg dark:text-light-bg tracking-tight">
                        Keim Notes
                    </h1>
                    <p className="text-dark-bg/60 dark:text-light-bg/60 text-center text-sm">
                        Local-first notes. Your data, your device, your rules.
                    </p>
                </div>

                {/* Storage Options */}
                <div className="flex flex-col gap-3 w-full">
                    {/* Option A: Vault Folder (Desktop Only) */}
                    {fsSupported && (
                        <button
                            onClick={onPickVault}
                            disabled={isPickingVault}
                            className="group flex items-start gap-4 p-5 rounded-xl border-2 border-indigo-500/30 hover:border-indigo-500 bg-indigo-500/5 hover:bg-indigo-500/10 transition-all duration-200 text-left w-full disabled:opacity-60"
                        >
                            <div className="mt-0.5 text-indigo-500 shrink-0">
                                <FolderOpen size={24} />
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-dark-bg dark:text-light-bg">
                                        Open Vault Folder
                                    </span>
                                    <span className="text-xs bg-indigo-500 text-white px-2 py-0.5 rounded-full">
                                        Recommended
                                    </span>
                                </div>
                                <p className="text-dark-bg/60 dark:text-light-bg/60 text-sm mt-1">
                                    Choose a folder on your device. Notes are saved as <code className="bg-dark-bg/10 dark:bg-light-bg/10 px-1 rounded">.md</code> files — readable by Obsidian, VS Code, or any editor.
                                </p>
                                {isPickingVault && (
                                    <p className="text-indigo-500 text-sm mt-2 font-medium">Waiting for permission...</p>
                                )}
                            </div>
                            <ArrowRight size={18} className="text-dark-bg/30 dark:text-light-bg/30 group-hover:text-indigo-500 transition-colors mt-1 shrink-0" />
                        </button>
                    )}

                    {/* Option B: Browser Storage */}
                    <button
                        onClick={onUseBrowserStorage}
                        className="group flex items-start gap-4 p-5 rounded-xl border-2 border-dark-bg/10 dark:border-light-bg/10 hover:border-dark-bg/30 dark:hover:border-light-bg/30 bg-transparent hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 transition-all duration-200 text-left w-full"
                    >
                        <div className="mt-0.5 text-dark-bg/40 dark:text-light-bg/40 shrink-0">
                            <Database size={24} />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <span className="font-semibold text-dark-bg dark:text-light-bg">
                                    Browser Storage
                                </span>
                                {!fsSupported && (
                                    <span className="text-xs bg-indigo-500 text-white px-2 py-0.5 rounded-full">
                                        Recommended
                                    </span>
                                )}
                            </div>
                            <p className="text-dark-bg/60 dark:text-light-bg/60 text-sm mt-1">
                                Notes are stored privately in your browser. Highly recommended to enable <strong>Cloud Sync</strong> after setup to prevent data loss.
                            </p>
                        </div>
                        <ArrowRight size={18} className="text-dark-bg/30 dark:text-light-bg/30 group-hover:text-dark-bg/60 dark:group-hover:text-light-bg/60 transition-colors mt-1 shrink-0" />
                    </button>
                </div>

                {/* Footer */}
                <div className="flex items-center gap-2 text-dark-bg/40 dark:text-light-bg/40 text-xs">
                    <Cloud size={14} />
                    <span>Optional Dropbox sync available in Settings after setup</span>
                </div>
            </div>
        </div>
    );
}
