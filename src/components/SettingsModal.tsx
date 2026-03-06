import { X, Moon, Sun, CloudSync, Monitor, CheckCircle2, AlertCircle, Key, Download, Upload, Info, HardDrive, Database } from 'lucide-react';
import { syncNotesWithDrive, isDriveConnected, getLastSyncTime, authorizeDropbox, loginToDropbox, getCustomClientId, setCustomClientId } from '../lib/sync';
import { exportToFolder, importMarkdownFiles } from '../lib/export-import';
import { useState, useEffect } from 'react';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    theme: 'light' | 'dark' | 'system';
    setTheme: (theme: 'light' | 'dark' | 'system') => void;
    onChangeVault?: () => Promise<void>;
    onSwitchToBrowserStorage?: () => Promise<void>;
}

export default function SettingsModal({ isOpen, onClose, theme, setTheme, onChangeVault, onSwitchToBrowserStorage }: SettingsModalProps) {
    const [syncing, setSyncing] = useState(false);
    const [connected, setConnected] = useState(false);
    const [lastSync, setLastSync] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [customClientId, setCustomClientIdState] = useState('');
    const [pickingVault, setPickingVault] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

    useEffect(() => {
        if (isOpen) {
            setConnected(isDriveConnected());
            setLastSync(getLastSyncTime());
            setCustomClientIdState(getCustomClientId());
            setError(null);
        }
    }, [isOpen]);

    const handleSync = async () => {
        setError(null);
        setSyncing(true);
        try {
            const isAuthorized = await authorizeDropbox();
            if (!isAuthorized) {
                await loginToDropbox();
                return; // Redirecting
            }
            await syncNotesWithDrive();
            setConnected(true);
            setLastSync(Date.now());
        } catch (e: any) {
            console.error(e);
            setError(e?.message || 'Sync failed. Ensure Dropbox App Key is configured.');
        } finally {
            setSyncing(false);
        }
    };

    const handleCustomClientIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.trim();
        setCustomClientIdState(val);
        setCustomClientId(val);
        setConnected(isDriveConnected());
    };

    if (!isOpen) return null;

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
                        <label className="text-sm font-medium opacity-70 uppercase tracking-wider">OneDrive</label>
                        <div className="p-4 bg-light-ui dark:bg-dark-ui rounded-lg space-y-4">
                            <div className="flex items-start justify-between">
                                <div>
                                    <h3 className="font-medium flex items-center gap-2">
                                        Cloud Sync
                                        {connected && (
                                            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">
                                                <CheckCircle2 size={10} /> Connected
                                            </span>
                                        )}
                                    </h3>
                                    <p className="text-xs opacity-70 mt-1 max-w-[200px] leading-relaxed">
                                        Securely backup your notes to your personal Dropbox App Folder.
                                    </p>
                                    {lastSync && (
                                        <p className="text-[10px] opacity-50 mt-2 font-mono">
                                            Last synced: {new Date(lastSync).toLocaleString()}
                                        </p>
                                    )}
                                </div>
                                <button
                                    onClick={handleSync}
                                    disabled={syncing}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-all shadow-sm ${syncing ? 'opacity-50 cursor-not-allowed bg-dark-bg/10 dark:bg-light-bg/10 text-dark-bg dark:text-light-bg' : connected ? 'bg-light-bg dark:bg-dark-bg text-dark-bg dark:text-light-bg hover:brightness-95 dark:hover:brightness-110 border border-light-ui/50 dark:border-dark-ui/50' : 'bg-dark-bg text-light-bg dark:bg-light-bg dark:text-dark-bg hover:opacity-90'}`}
                                >
                                    <CloudSync size={16} className={syncing ? 'animate-spin' : ''} />
                                    {syncing ? 'Syncing...' : connected ? 'Sync Now' : 'Sign in'}
                                </button>
                            </div>
                            {error && (
                                <div className="flex items-start gap-2 bg-red-500/10 text-red-600 dark:text-red-400 p-2.5 rounded text-xs font-medium">
                                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                    <p>
                                        {error}
                                    </p>
                                </div>
                            )}

                            {/* Custom Dropbox Key Input */}
                            <div className="pt-2 border-t border-light-bg dark:border-dark-bg">
                                <label className="block text-xs font-medium opacity-70 mb-1.5 flex items-center gap-1.5">
                                    <Key size={12} /> Custom Dropbox App Key (Optional)
                                </label>
                                <input
                                    type="password"
                                    value={customClientId}
                                    onChange={handleCustomClientIdChange}
                                    placeholder={import.meta.env.VITE_DROPBOX_APP_KEY ? "Using built-in key..." : "e.g. j2p... (from Dropbox)"}
                                    className="w-full bg-light-bg dark:bg-dark-bg border border-light-bg dark:border-dark-bg rounded-md px-3 py-2 text-sm text-dark-bg dark:text-light-bg placeholder:opacity-40 focus:outline-none focus:ring-2 focus:ring-dark-bg/20 dark:focus:ring-light-bg/20 transition-shadow"
                                />
                                <p className="text-[10px] opacity-60 mt-1.5 leading-tight">
                                    Overrides the default App Key. Stored securely in your browser.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Vault / Storage Section */}
                <div className="p-6 border-t border-light-ui dark:border-dark-ui space-y-6">
                    {(onChangeVault || onSwitchToBrowserStorage) && (
                        <div className="space-y-3">
                            <label className="text-sm font-medium opacity-70 uppercase tracking-wider">Storage Mode</label>
                            <div className="p-4 bg-light-ui dark:bg-dark-ui rounded-lg space-y-4">
                                <div className="flex items-start gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0">
                                        <Info size={16} />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium">Which storage should I use?</p>
                                        <p className="text-xs opacity-70 leading-relaxed">
                                            <strong>Vault:</strong> Best for desktop. Files are saved as real <code className="bg-dark-bg/10 dark:bg-light-bg/10 px-1 rounded">.md</code> files on your computer.
                                            <br />
                                            <strong>Browser:</strong> Best for mobility. Notes are kept in your browser database and synced via Cloud.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2 pt-2">
                                    {onChangeVault && (
                                        <button
                                            disabled={pickingVault}
                                            onClick={async () => {
                                                setPickingVault(true);
                                                try {
                                                    await onChangeVault();
                                                    onClose();
                                                } finally {
                                                    setPickingVault(false);
                                                }
                                            }}
                                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-light-bg dark:bg-dark-bg text-dark-bg dark:text-light-bg border border-light-ui dark:border-dark-ui hover:bg-indigo-500/10 hover:border-indigo-500/50 transition-all disabled:opacity-50"
                                        >
                                            <HardDrive size={16} className="opacity-70" />
                                            {pickingVault ? 'Waiting for folder...' : 'Use Local Disk (Vault)'}
                                        </button>
                                    )}
                                    {onSwitchToBrowserStorage && (
                                        <button
                                            onClick={async () => { await onSwitchToBrowserStorage(); onClose(); }}
                                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-dark-bg/60 dark:text-light-bg/60 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 transition-all"
                                        >
                                            <Database size={16} className="opacity-70" />
                                            Switch to Browser Storage
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Advanced Utilities */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium opacity-70 uppercase tracking-wider">Advanced Troubleshooting</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={async () => {
                                    setExporting(true);
                                    try {
                                        const count = await exportToFolder();
                                        setFeedback({ type: 'success', msg: `Exported ${count} notes!` });
                                    } catch (e: any) {
                                        setFeedback({ type: 'error', msg: e?.message || 'Export failed' });
                                    } finally {
                                        setExporting(false);
                                    }
                                }}
                                disabled={exporting}
                                className="flex flex-col items-center gap-2 p-3 rounded-xl border border-light-ui dark:border-dark-ui hover:bg-light-ui dark:hover:bg-dark-ui transition-colors text-center"
                            >
                                <Download size={18} className="opacity-70" />
                                <div className="space-y-0.5">
                                    <span className="text-xs font-bold uppercase tracking-widest">Export All</span>
                                    <p className="text-[10px] opacity-60">Save notes to folder</p>
                                </div>
                            </button>

                            <button
                                onClick={() => {
                                    const input = document.createElement('input');
                                    input.type = 'file';
                                    input.multiple = true;
                                    input.accept = '.md';
                                    input.webkitdirectory = true; // Enables folder selection
                                    // TypeScript workaround for webkitdirectory
                                    (input as any).directory = true;

                                    input.onchange = async (e: any) => {
                                        const fileList = Array.from(e.target.files) as File[];
                                        if (fileList.length === 0) return;
                                        setImporting(true);
                                        try {
                                            // Map files to include their relative paths
                                            const fileData = fileList.map(f => ({
                                                file: f,
                                                path: f.webkitRelativePath || f.name
                                            }));

                                            const count = await importMarkdownFiles(fileData);
                                            setFeedback({ type: 'success', msg: `Imported ${count} notes!` });
                                        } catch (e: any) {
                                            setFeedback({ type: 'error', msg: e?.message || 'Import failed' });
                                        } finally {
                                            setImporting(false);
                                        }
                                    };
                                    input.click();
                                }}
                                disabled={importing}
                                className="flex flex-col items-center gap-2 p-3 rounded-xl border border-light-ui dark:border-dark-ui hover:bg-light-ui dark:hover:bg-dark-ui transition-colors text-center"
                            >
                                <Upload size={18} className="opacity-70" />
                                <div className="space-y-0.5">
                                    <span className="text-xs font-bold uppercase tracking-widest">Import Files</span>
                                    <p className="text-[10px] opacity-60">Load .md files</p>
                                </div>
                            </button>
                        </div>
                        {feedback && (
                            <div className={`mt-2 p-2 rounded text-[10px] font-bold uppercase tracking-widest text-center ${feedback.type === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                                {feedback.msg}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
