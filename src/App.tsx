import { useEffect, useCallback } from 'react';
import { useAppStore } from './store';
import { reloadTree, createNote, createFolder, getStorageMode, openVaultPicker, restoreVaultHandle, hasSavedVault } from './lib/vault';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import WelcomeScreen from './components/WelcomeScreen';
import SettingsModal from './components/SettingsModal';
import NavigationDock from './components/NavigationDock';
import { PanelLeft, FileText } from 'lucide-react';
import { KEYS } from './lib/constants';

export default function App() {
    const {
        appState, setAppState,
        isSidebarOpen, setSidebarOpen,
        isSettingsOpen, setIsSettingsOpen, settingsTab, setSettingsTab,
        theme, setTheme,
        selectedNotePath, setSelectedNotePath,
        selectedFolderPath, setSelectedFolderPath,
        tree, setTree,
    } = useAppStore();

    const refreshTree = useCallback(async () => {
        setTree(await reloadTree());
    }, [setTree]);

    const handleSelectNote = (path: string | null) => {
        setSelectedNotePath(path);
        if (path !== null && window.innerWidth < 768) setSidebarOpen(false);
    };

    const handleAddNote = useCallback(async (parentPath?: string) => {
        const parent = parentPath ?? selectedFolderPath ?? '';
        const path = await createNote(parent, 'New Note');
        await refreshTree();
        setSelectedNotePath(path);
        if (window.innerWidth < 768) setSidebarOpen(false);
        setTimeout(() => window.dispatchEvent(new CustomEvent('keim_focus_title', { detail: path })), 50);
    }, [selectedFolderPath, refreshTree, setSelectedNotePath, setSidebarOpen]);

    const handleAddFolder = useCallback(async (parentPath?: string) => {
        const parent = parentPath ?? selectedFolderPath ?? '';
        const folderPath = await createFolder(parent, 'New Folder');
        await refreshTree();
        setSelectedFolderPath(folderPath);
    }, [selectedFolderPath, refreshTree, setSelectedFolderPath]);

    // --- Init ---
    useEffect(() => {
        async function init() {
            if (navigator.storage && navigator.storage.persist) {
                try { await navigator.storage.persist(); } catch { /* ignore */ }
            }
            const mode = getStorageMode();
            if (mode === 'unset' || !(await hasSavedVault())) {
                setAppState('welcome');
                return;
            }
            const handle = await restoreVaultHandle(false);
            if (handle) {
                await refreshTree();
                setAppState('ready');
                const sel = localStorage.getItem(KEYS.SELECTED_NOTE_PATH);
                if (sel && tree.notes.some(n => n.path === sel)) {
                    setSelectedNotePath(sel);
                }
            } else {
                setAppState('welcome');
            }
        }
        init().catch(console.error);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handlePickVault = useCallback(async () => {
        const handle = await openVaultPicker();
        if (handle) {
            await refreshTree();
            setAppState('ready');
        }
    }, [refreshTree, setAppState]);

    // --- Theme Application ---
    useEffect(() => {
        const applyTheme = (currentTheme: 'light' | 'dark' | 'system') => {
            const root = window.document.documentElement;
            root.classList.remove('light', 'dark');
            const isDark = currentTheme === 'system'
                ? window.matchMedia('(prefers-color-scheme: dark)').matches
                : currentTheme === 'dark';
            root.classList.add(isDark ? 'dark' : 'light');
            const color = isDark ? '#1C1B21' : '#FEFEFE';
            document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute('content', color));
        };
        applyTheme(theme);
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => { if (theme === 'system') applyTheme('system'); };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [theme]);

    const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.altKey) {
            if (e.code === 'KeyN') { e.preventDefault(); handleAddNote(); }
            else if (e.code === 'KeyF') { e.preventDefault(); handleAddFolder(); }
            else if (e.code === 'KeyD' && selectedNotePath) {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('keim_prepare_delete', { detail: selectedNotePath }));
            }
        }
    }, [handleAddNote, handleAddFolder, selectedNotePath]);

    useEffect(() => {
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [handleGlobalKeyDown]);

    if (appState === 'loading') {
        return <div className="flex h-screen w-full items-center justify-center bg-light-bg dark:bg-dark-bg" />;
    }

    if (appState === 'welcome') {
        return (
            <WelcomeScreen
                onPickVault={handlePickVault}
                isPickingVault={false}
                installPrompt={(window as unknown as { deferredPrompt?: { prompt: () => void; userChoice: Promise<{ outcome: string }> } }).deferredPrompt ?? null}
            />
        );
    }

    return (
        <div className="flex h-screen w-full overflow-hidden relative">
            <Sidebar
                onOpenSettings={() => { setSettingsTab('general'); setSidebarOpen(false); setIsSettingsOpen(true); }}
            />

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                theme={theme}
                setTheme={setTheme}
                initialTab={settingsTab}
            />

            <button
                onClick={() => setSidebarOpen(!isSidebarOpen)}
                className="fixed z-[60] p-2.5 bg-light-bg/70 dark:bg-dark-bg/70 backdrop-blur-md border border-dark-bg/5 dark:border-light-bg/5 shadow-sm hover:bg-light-ui dark:hover:bg-dark-ui rounded-full text-dark-bg dark:text-light-bg transition-all"
                style={{ top: 'calc(1rem + var(--spacing-safe-top, 0px))', left: 'calc(1rem + var(--spacing-safe-left, 0px))' }}
                aria-label="Toggle Sidebar"
            >
                <PanelLeft size={22} />
            </button>

            <main className={`flex-1 flex flex-col h-full w-full overflow-hidden relative transition-all duration-300 ease-in-out ${isSidebarOpen ? 'md:ml-64' : 'ml-0'}`}>
                <div className="flex-1 flex flex-col overflow-hidden">
                    {selectedNotePath ? (
                        <div key={selectedNotePath} className="flex-1 flex flex-col h-full overflow-hidden animate-fadein">
                            <Editor notePath={selectedNotePath} onSelectNote={handleSelectNote} />
                        </div>
                    ) : (
                        <div key="empty-state" className="flex h-full flex-col items-center justify-center p-6 text-center animate-fadein">
                            <div className="w-24 h-24 mb-8 text-dark-bg/5 dark:text-light-bg/5 relative">
                                <FileText size={96} strokeWidth={1} className="absolute inset-0" />
                            </div>
                            <div className="space-y-2 max-w-sm">
                                <h3 className="text-xl font-bold text-dark-bg dark:text-light-bg tracking-tight">Focus on your ideas</h3>
                                <p className="text-dark-bg/40 dark:text-light-bg/40 text-sm leading-relaxed">
                                    Select a note from the sidebar or press <kbd className="font-sans px-1.5 py-0.5 bg-dark-bg/5 dark:bg-light-bg/5 border border-dark-bg/10 dark:border-light-bg/10 rounded-md text-xs font-bold">Alt + N</kbd> to start something new.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {appState === 'ready' && (
                    <NavigationDock
                        onAddNote={() => handleAddNote()}
                        onAddFolder={() => handleAddFolder()}
                        isSidebarOpen={isSidebarOpen}
                    />
                )}
            </main>
        </div>
    );
}
