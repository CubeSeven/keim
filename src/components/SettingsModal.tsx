import { X, Moon, Sun, Monitor, CheckCircle2, AlertCircle, Download, Upload, Info, HardDrive, Database, Settings2, Palette, RefreshCw } from 'lucide-react';
import { syncNotesWithDrive, isDriveConnected, getLastSyncTime, authorizeDropbox, loginToDropbox, disconnectDropbox } from '../lib/sync';
import { exportToFolder, importMarkdownFiles } from '../lib/export-import';
import { useState, useEffect } from 'react';

const DropboxIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <path d="M6 1.807L0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z" fill="currentColor" />
    </svg>
);

const GoogleDriveIcon = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <path d="M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z" fill="currentColor" />
    </svg>
);

const OneDriveIcon = ({ className }: { className?: string }) => (
    <svg viewBox="-1.132 4.727 34.057 21.467" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <path d="M12.202 11.193v-.001l6.718 4.024 4.003-1.685A6.477 6.477 0 0 1 25.5 13c.148 0 .294.007.439.016a10 10 0 0 0-18.041-3.013L8 10a7.96 7.96 0 0 1 4.202 1.193z" fill="#0364b8" />
        <path d="M12.203 11.192A7.96 7.96 0 0 0 8 10l-.102.003a7.997 7.997 0 0 0-6.46 12.57L7.36 20.08l2.634-1.108 5.863-2.468 3.062-1.288z" fill="#0078d4" />
        <path d="M25.939 13.016A6.577 6.577 0 0 0 25.5 13a6.477 6.477 0 0 0-2.576.532l-4.004 1.684 1.161.695 3.805 2.279 1.66.994 5.677 3.4a6.5 6.5 0 0 0-5.284-9.568z" fill="#1490df" />
        <path d="M25.546 19.184l-1.66-.994-3.805-2.28-1.16-.694-3.063 1.288-5.863 2.468L7.36 20.08l-5.924 2.493A7.989 7.989 0 0 0 8 26h17.5a6.498 6.498 0 0 0 5.723-3.416z" fill="#28a8ea" />
    </svg>
);

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    theme: 'light' | 'dark' | 'system';
    setTheme: (theme: 'light' | 'dark' | 'system') => void;
    onChangeVault?: () => Promise<void>;
    onSwitchToBrowserStorage?: () => Promise<void>;
    onSyncStatusChange?: (connected: boolean) => void;
    onInstallPWA?: () => void;
}

export default function SettingsModal({ isOpen, onClose, theme, setTheme, onChangeVault, onSwitchToBrowserStorage, onSyncStatusChange, onInstallPWA }: SettingsModalProps) {
    const [syncing, setSyncing] = useState(false);
    const [connected, setConnected] = useState(false);
    const [lastSync, setLastSync] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pickingVault, setPickingVault] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

    // UI State
    const [activeTab, setActiveTab] = useState<'general' | 'sync' | 'appearance'>('general');

    useEffect(() => {
        if (isOpen) {
            setConnected(isDriveConnected());
            setLastSync(getLastSyncTime());
            setError(null);
            setFeedback(null);
        }
    }, [isOpen]);

    const handleConnect = async () => {
        setError(null);
        setSyncing(true);
        try {
            const isAuthorized = await authorizeDropbox();
            if (!isAuthorized) {
                await loginToDropbox();
                return; // Redirecting to Dropbox
            }
            // Already authorized — run first sync
            await syncNotesWithDrive();
            setConnected(true);
            setLastSync(Date.now());
            onSyncStatusChange?.(true);
        } catch (e) {
            console.error(e);
            const msg = (e as Error)?.message || 'Connection failed. Please try again.';
            setError(msg);
        } finally {
            setSyncing(false);
        }
    };

    const handleSyncNow = async () => {
        setError(null);
        setSyncing(true);
        try {
            await syncNotesWithDrive();
            setLastSync(Date.now());
        } catch (e) {
            console.error(e);
            const msg = (e as Error)?.message || 'Sync failed. Please try again.';
            setError(msg);
        } finally {
            setSyncing(false);
        }
    };

    const handleDisconnect = () => {
        disconnectDropbox();
        setConnected(false);
        setLastSync(null);
        setError(null);
        onSyncStatusChange?.(false);
    };

    // Clear feedback on tab change
    useEffect(() => {
        setFeedback(null);
    }, [activeTab]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-dark-bg/50 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />
            <div className="relative w-full max-w-2xl bg-light-bg dark:bg-dark-bg rounded-xl shadow-2xl border border-light-ui dark:border-dark-ui flex flex-col md:flex-row overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Fixed Max-Height container for the modal content */}
                <div className="flex flex-col md:flex-row w-full max-h-[85vh] md:max-h-[600px] md:h-[600px]">
                    {/* Sidebar / Tabs Navigation */}
                    <div className="w-full md:w-56 bg-light-ui/40 dark:bg-dark-ui/40 border-b md:border-b-0 md:border-r border-light-ui dark:border-dark-ui flex flex-col shrink-0 flex-none">
                        <div className="p-4 border-b border-light-ui dark:border-dark-ui hidden md:block">
                            <h2 className="font-semibold text-lg text-dark-bg dark:text-light-bg">Settings</h2>
                        </div>
                        <nav className="flex md:flex-col p-2 md:p-3 gap-1 overflow-x-auto md:overflow-visible">
                            <button
                                onClick={() => setActiveTab('general')}
                                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap
                                    ${activeTab === 'general' ? 'bg-light-bg dark:bg-dark-bg text-dark-bg dark:text-light-bg shadow-sm' : 'text-dark-bg/70 dark:text-light-bg/70 hover:bg-light-bg/50 dark:hover:bg-dark-bg/50'}`}
                            >
                                <Settings2 size={16} /> General
                            </button>
                            <button
                                onClick={() => setActiveTab('sync')}
                                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap
                                    ${activeTab === 'sync' ? 'bg-light-bg dark:bg-dark-bg text-dark-bg dark:text-light-bg shadow-sm' : 'text-dark-bg/70 dark:text-light-bg/70 hover:bg-light-bg/50 dark:hover:bg-dark-bg/50'}`}
                            >
                                <RefreshCw size={16} /> Cloud Sync
                            </button>
                            <button
                                onClick={() => setActiveTab('appearance')}
                                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap
                                    ${activeTab === 'appearance' ? 'bg-light-bg dark:bg-dark-bg text-dark-bg dark:text-light-bg shadow-sm' : 'text-dark-bg/70 dark:text-light-bg/70 hover:bg-light-bg/50 dark:hover:bg-dark-bg/50'}`}
                            >
                                <Palette size={16} /> Appearance
                            </button>
                        </nav>
                        <div className="mt-auto p-4 hidden md:block">
                            <p className="text-[10px] opacity-40 text-center font-mono uppercase tracking-widest">Keim Notes v1.0</p>
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 flex flex-col relative overflow-hidden bg-light-bg dark:bg-dark-bg">
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 z-10 p-1.5 hover:bg-light-ui dark:hover:bg-dark-ui rounded-lg text-dark-bg dark:text-light-bg transition-colors"
                        >
                            <X size={20} />
                        </button>

                        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 text-dark-bg dark:text-light-bg">

                            {/* --- General Tab --- */}
                            {activeTab === 'general' && (
                                <div className="space-y-8 animate-in fade-in duration-200">
                                    <div className="pb-2 border-b border-light-ui dark:border-dark-ui">
                                        <h3 className="text-xl font-semibold">General Options</h3>
                                    </div>

                                    {/* Vault / Storage Section */}
                                    {(onChangeVault || onSwitchToBrowserStorage) && (
                                        <div className="space-y-3">
                                            <label className="text-sm font-medium opacity-70 uppercase tracking-wider">Storage Mode</label>
                                            <div className="p-4 bg-light-ui/50 dark:bg-dark-ui/50 rounded-lg space-y-4 border border-light-ui dark:border-dark-ui">
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
                                                            className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium bg-light-bg dark:bg-dark-bg text-dark-bg dark:text-light-bg border border-light-ui dark:border-dark-ui hover:bg-indigo-500/10 hover:border-indigo-500/50 transition-all disabled:opacity-50"
                                                        >
                                                            <HardDrive size={16} className="text-indigo-500" />
                                                            {pickingVault ? 'Waiting for folder…' : 'Use Local Disk (Vault)'}
                                                        </button>
                                                    )}
                                                    {onSwitchToBrowserStorage && (
                                                        <button
                                                            onClick={async () => { await onSwitchToBrowserStorage(); onClose(); }}
                                                            className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-dark-bg/70 dark:text-light-bg/70 hover:bg-dark-bg/5 dark:hover:bg-light-bg/5 transition-all w-full text-left"
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
                                        <label className="text-sm font-medium opacity-70 uppercase tracking-wider">Advanced</label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                onClick={async () => {
                                                    setExporting(true);
                                                    try {
                                                        const count = await exportToFolder();
                                                        setFeedback({ type: 'success', msg: `Exported ${count} notes!` });
                                                    } catch (e) {
                                                        const msg = (e as Error)?.message || 'Export failed';
                                                        setFeedback({ type: 'error', msg });
                                                    } finally {
                                                        setExporting(false);
                                                    }
                                                }}
                                                disabled={exporting}
                                                className="flex items-center gap-3 p-3 rounded-lg border border-light-ui dark:border-dark-ui hover:bg-light-ui/50 dark:hover:bg-dark-ui/50 transition-colors text-left"
                                            >
                                                <div className="p-2 bg-dark-bg/5 dark:bg-light-bg/5 rounded-md shrink-0">
                                                    <Download size={16} className="opacity-70" />
                                                </div>
                                                <div>
                                                    <span className="text-sm font-semibold block">Export All</span>
                                                    <span className="text-xs opacity-60">Save notes to folder</span>
                                                </div>
                                            </button>

                                            <button
                                                onClick={() => {
                                                    const input = document.createElement('input');
                                                    input.type = 'file';
                                                    input.multiple = true;
                                                    input.accept = '.md';
                                                    input.webkitdirectory = true;
                                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                    (input as any).directory = true;

                                                    input.onchange = async (e: Event) => {
                                                        const target = e.target as HTMLInputElement;
                                                        const fileList = Array.from(target.files || []) as File[];
                                                        if (fileList.length === 0) return;
                                                        setImporting(true);
                                                        try {
                                                            const fileData = fileList.map(f => ({
                                                                file: f,
                                                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                                path: (f as any).webkitRelativePath || f.name
                                                            }));
                                                            const count = await importMarkdownFiles(fileData);
                                                            setFeedback({ type: 'success', msg: `Imported ${count} notes!` });
                                                        } catch (err) {
                                                            const msg = (err as Error)?.message || 'Import failed';
                                                            setFeedback({ type: 'error', msg });
                                                        } finally {
                                                            setImporting(false);
                                                        }
                                                    };
                                                    input.click();
                                                }}
                                                disabled={importing}
                                                className="flex items-center gap-3 p-3 rounded-lg border border-light-ui dark:border-dark-ui hover:bg-light-ui/50 dark:hover:bg-dark-ui/50 transition-colors text-left"
                                            >
                                                <div className="p-2 bg-dark-bg/5 dark:bg-light-bg/5 rounded-md shrink-0">
                                                    <Upload size={16} className="opacity-70" />
                                                </div>
                                                <div>
                                                    <span className="text-sm font-semibold block">Import Files</span>
                                                    <span className="text-xs opacity-60">Load .md files</span>
                                                </div>
                                            </button>

                                            {onInstallPWA && (
                                                <button
                                                    onClick={() => {
                                                        onInstallPWA();
                                                        onClose();
                                                    }}
                                                    className="col-span-2 flex items-center justify-between p-4 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/20 group mt-2"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <Monitor size={20} className="group-hover:bounce" />
                                                        <div className="text-left">
                                                            <span className="text-sm font-bold tracking-wide block">Install Native App</span>
                                                            <p className="text-xs opacity-90 font-medium">Use Keim Notes as a desktop app</p>
                                                        </div>
                                                    </div>
                                                    <Download size={18} className="opacity-80" />
                                                </button>
                                            )}
                                        </div>
                                        {feedback && (
                                            <div className={`mt-3 p-2.5 rounded-lg text-xs font-medium flex items-center gap-2 ${feedback.type === 'success' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
                                                {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                                {feedback.msg}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* --- Sync Tab --- */}
                            {activeTab === 'sync' && (
                                <div className="space-y-8 animate-in fade-in duration-200">
                                    <div className="pb-2 border-b border-light-ui dark:border-dark-ui">
                                        <h3 className="text-xl font-semibold">Cloud Sync</h3>
                                    </div>

                                    <div className="space-y-4">
                                        {/* Dropbox Provider */}
                                        <div className="border border-light-ui dark:border-dark-ui rounded-xl overflow-hidden shadow-sm">
                                            <div className="p-4 bg-light-ui/30 dark:bg-dark-ui/30 flex items-center justify-between border-b border-light-ui dark:border-dark-ui">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-lg bg-[#0061FF]/10 flex items-center justify-center shrink-0">
                                                        <DropboxIcon className="w-6 h-6 text-[#0061FF]" />
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-sm">Dropbox</p>
                                                        {connected ? (
                                                            <p className="text-xs text-green-600 dark:text-green-500 font-medium flex items-center gap-1">
                                                                <CheckCircle2 size={12} /> Connected
                                                            </p>
                                                        ) : (
                                                            <p className="text-xs opacity-60">Not connected</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="p-4 bg-light-bg dark:bg-dark-bg flex flex-col gap-3">
                                                {connected ? (
                                                    <>
                                                        <div className="flex justify-between items-center text-sm">
                                                            <span className="opacity-70">Status</span>
                                                            {lastSync ? (
                                                                <span className="font-mono text-xs opacity-70">Last synced: {new Date(lastSync).toLocaleString()}</span>
                                                            ) : (
                                                                <span className="opacity-70">Waiting for sync</span>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-2 mt-2">
                                                            <button
                                                                onClick={handleSyncNow}
                                                                disabled={syncing}
                                                                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-semibold bg-dark-bg text-light-bg dark:bg-light-bg dark:text-dark-bg hover:opacity-90 transition-all disabled:opacity-50"
                                                            >
                                                                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                                                                {syncing ? 'Syncing…' : 'Sync Now'}
                                                            </button>
                                                            <button
                                                                onClick={handleDisconnect}
                                                                className="px-3 py-2 rounded-md text-sm font-medium text-red-500 bg-red-500/10 hover:bg-red-500/20 transition-all"
                                                                title="Disconnect Dropbox"
                                                            >
                                                                Disconnect
                                                            </button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <p className="text-sm opacity-80 mb-2">Connect your Dropbox account to automatically backup and sync your notes across devices.</p>
                                                        <button
                                                            onClick={handleConnect}
                                                            disabled={syncing}
                                                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold bg-[#0061FF] text-white hover:bg-[#0051d6] transition-all disabled:opacity-50"
                                                        >
                                                            {syncing ? <RefreshCw size={16} className="animate-spin" /> : <DropboxIcon className="w-5 h-5" />}
                                                            {syncing ? 'Connecting…' : 'Connect with Dropbox'}
                                                        </button>
                                                    </>
                                                )}
                                                {error && (
                                                    <div className="flex items-start gap-2 bg-red-500/10 text-red-600 dark:text-red-400 p-2.5 rounded-lg text-xs font-medium mt-2">
                                                        <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                                        <p>{error}</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Google Drive Provider (Coming Soon) */}
                                        <div className="border border-light-ui dark:border-dark-ui rounded-xl overflow-hidden shadow-sm opacity-60 grayscale cursor-not-allowed group">
                                            <div className="p-4 bg-light-ui/30 dark:bg-dark-ui/30 flex items-center justify-between border-b border-light-ui dark:border-dark-ui">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                                                        <GoogleDriveIcon className="w-6 h-6 text-emerald-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-sm">Google Drive</p>
                                                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mt-0.5">Coming Soon</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="p-4 bg-light-bg dark:bg-dark-bg">
                                                <button disabled className="w-full py-2.5 rounded-md text-sm font-semibold bg-light-ui dark:bg-dark-ui text-dark-bg/50 dark:text-light-bg/50 cursor-not-allowed">
                                                    Not Available
                                                </button>
                                            </div>
                                        </div>

                                        {/* OneDrive Provider (Coming Soon) */}
                                        <div className="border border-light-ui dark:border-dark-ui rounded-xl overflow-hidden shadow-sm opacity-60 grayscale cursor-not-allowed">
                                            <div className="p-4 bg-light-ui/30 dark:bg-dark-ui/30 flex items-center justify-between border-b border-light-ui dark:border-dark-ui">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-lg bg-[#0078D4]/10 flex items-center justify-center shrink-0">
                                                        <OneDriveIcon className="w-6 h-6 text-[#0078D4]" />
                                                    </div>
                                                    <div>
                                                        <p className="font-semibold text-sm">OneDrive</p>
                                                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#0078D4] mt-0.5">Coming Soon</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="p-4 bg-light-bg dark:bg-dark-bg">
                                                <button disabled className="w-full py-2.5 rounded-md text-sm font-semibold bg-light-ui dark:bg-dark-ui text-dark-bg/50 dark:text-light-bg/50 cursor-not-allowed">
                                                    Not Available
                                                </button>
                                            </div>
                                        </div>

                                    </div>
                                </div>
                            )}

                            {/* --- Appearance Tab --- */}
                            {activeTab === 'appearance' && (
                                <div className="space-y-8 animate-in fade-in duration-200">
                                    <div className="pb-2 border-b border-light-ui dark:border-dark-ui">
                                        <h3 className="text-xl font-semibold">Appearance</h3>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-semibold">Theme</p>
                                            <p className="text-xs opacity-70">Select your preferred color scheme.</p>
                                        </div>

                                        {/* Compact Theme Toggle */}
                                        <div className="flex items-center bg-light-ui dark:bg-dark-ui p-1 rounded-full border border-dark-bg/5 dark:border-light-bg/5">
                                            <button
                                                onClick={() => setTheme('light')}
                                                title="Light Mode"
                                                className={`p-2 rounded-full transition-all flex items-center justify-center ${theme === 'light' ? 'bg-light-bg text-dark-bg shadow-sm' : 'text-dark-bg/50 dark:text-light-bg/50 hover:text-dark-bg dark:hover:text-light-bg'}`}
                                            >
                                                <Sun size={16} />
                                            </button>
                                            <button
                                                onClick={() => setTheme('system')}
                                                title="System Theme"
                                                className={`p-2 rounded-full transition-all flex items-center justify-center ${theme === 'system' ? 'bg-light-bg dark:bg-dark-bg text-dark-bg dark:text-light-bg shadow-sm' : 'text-dark-bg/50 dark:text-light-bg/50 hover:text-dark-bg dark:hover:text-light-bg'}`}
                                            >
                                                <Monitor size={16} />
                                            </button>
                                            <button
                                                onClick={() => setTheme('dark')}
                                                title="Dark Mode"
                                                className={`p-2 rounded-full transition-all flex items-center justify-center ${theme === 'dark' ? 'bg-dark-bg text-light-bg shadow-sm' : 'text-dark-bg/50 dark:text-light-bg/50 hover:text-dark-bg dark:hover:text-light-bg'}`}
                                            >
                                                <Moon size={16} />
                                            </button>
                                        </div>
                                    </div>

                                </div>
                            )}

                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
