import { useEffect, useCallback, Suspense, lazy } from 'react';
import Sidebar from './components/Sidebar';
import { db, addItem } from './lib/db';
import { PanelLeft, HardDrive, FileText } from 'lucide-react';
import { disconnectDropbox } from './lib/sync';
import { getStorageMode, setStorageMode } from './lib/vault';
import NavigationDock from './components/NavigationDock';
import CloudSyncPrompt from './components/CloudSyncPrompt';
import { motion, AnimatePresence } from 'framer-motion';

const Editor = lazy(() => import('./components/Editor'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));
const WelcomeScreen = lazy(() => import('./components/WelcomeScreen'));
const CommandPalette = lazy(() => import('./components/CommandPalette').then(mod => ({ default: mod.CommandPalette })));
const SmartFolderPopup = lazy(() => import('./components/SmartFolderPopup'));

const FallbackSpinner = () => (
  <div className="flex w-full h-full items-center justify-center p-8">
    <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
  </div>
);
import { useAppStore } from './store';
import { useAppInit } from './hooks/useAppInit';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'disconnected';



function App() {
  const {
      selectedNoteId, setSelectedNoteId,
      isSidebarOpen, setSidebarOpen,
      isSettingsOpen, setIsSettingsOpen,
      settingsTab, setSettingsTab,
      theme, setTheme,
      syncStatus, setSyncStatus,
      lastSyncTime,
      isVaultLocked,
      smartPopupState, setSmartPopupState
  } = useAppStore();

  const {
      appState, setAppState,
      isPickingVault,
      installPrompt, handleInstallPWA,
      handlePickVault, handleUnlockVault, handleUseBrowserStorage,
      doSync
  } = useAppInit();

  const storageMode = getStorageMode();

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
      document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
        meta.setAttribute('content', color);
      });
    };
    applyTheme(theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (theme === 'system') applyTheme('system'); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // --- Smart Folder Popup Listener ---
  useEffect(() => {
    const handleOpenSmartPopup = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setSmartPopupState({
        isOpen: true,
        folderId: detail.folderId,
        folderTitle: detail.folderTitle
      });
    };
    window.addEventListener('keim_open_smart_folder_popup', handleOpenSmartPopup);
    return () => window.removeEventListener('keim_open_smart_folder_popup', handleOpenSmartPopup);
  }, [setSmartPopupState]);

  // --- Global Creation Handlers ---
  const handleSelectNote = (id: number | null) => {
    setSelectedNoteId(id);
    if (id !== null && window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleAddNote = useCallback(async (explicitParentId?: number) => {
    let parentId = explicitParentId ?? 0;
    if (explicitParentId === undefined && selectedNoteId) {
      const currentNote = await db.items.get(selectedNoteId);
      if (currentNote) parentId = currentNote.parentId;
    }

    const id = await addItem({ parentId, type: 'note', title: 'New Note' }, '');
    localStorage.setItem('keim_has_user_edits', 'true');

    if (getStorageMode() === 'vault') {
      try {
        const { writeNoteToVault, notePathFromTitle } = await import('./lib/vault');
        const { getItemPath } = await import('./lib/db');
        const allItems = await db.items.toArray();
        const parentPath = getItemPath(parentId, allItems);
        const notePath = notePathFromTitle('New Note', parentPath);
        await writeNoteToVault(notePath, '');
      } catch (e) {
        console.warn('Could not write new note to vault immediately', e);
      }
    }

    setSelectedNoteId(id as number);
    if (window.innerWidth < 768) setSidebarOpen(false);

    const tryFocus = () => window.dispatchEvent(new CustomEvent('keim_focus_title', { detail: id }));
    setTimeout(tryFocus, 50);
    setTimeout(tryFocus, 150);
    setTimeout(tryFocus, 300);
  }, [selectedNoteId, setSelectedNoteId, setSidebarOpen]);

  const handleAddFolder = useCallback(async (explicitParentId?: number) => {
    let parentId = explicitParentId ?? 0;
    if (explicitParentId === undefined && selectedNoteId) {
      const currentNote = await db.items.get(selectedNoteId);
      if (currentNote) parentId = currentNote.parentId;
    }

    const id = await addItem({ parentId, type: 'folder', title: 'New Folder' }, '');
    localStorage.setItem('keim_has_user_edits', 'true');

    if (getStorageMode() === 'vault') {
      try {
        const { createFolderInVault } = await import('./lib/vault');
        const { getItemPath } = await import('./lib/db');
        const allItems = await db.items.toArray();
        const parentPath = getItemPath(parentId, allItems);
        const folderPath = parentPath ? `${parentPath}/New Folder` : 'New Folder';
        await createFolderInVault(folderPath);
      } catch (e) {
        console.warn('Could not create folder in vault immediately', e);
      }
    }

    if (window.innerWidth < 768) setSidebarOpen(true);

    const tryRename = () => window.dispatchEvent(new CustomEvent('keim_rename_node', { detail: id }));
    setTimeout(tryRename, 50);
    setTimeout(tryRename, 150);
    setTimeout(tryRename, 300);
  }, [selectedNoteId, setSidebarOpen]);

  useKeyboardShortcuts({ handleAddNote, handleAddFolder, doSync, selectedNoteId });

  // --- Render States ---
  if (appState === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-light-bg dark:bg-dark-bg">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (appState === 'welcome') {
    return (
      <Suspense fallback={<FallbackSpinner />}>
        <WelcomeScreen
          onPickVault={handlePickVault}
          onUseBrowserStorage={handleUseBrowserStorage}
          isPickingVault={isPickingVault}
        />
      </Suspense>
    );
  }

  if (appState === 'restore-vault') {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-light-bg dark:bg-dark-bg gap-4 p-6 text-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        <p className="text-dark-bg/70 dark:text-light-bg/70">Reconnecting to your vault...</p>
      </div>
    );
  }

  if (appState === 'needs-vault-permission') {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-light-bg dark:bg-dark-bg gap-6 p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-500">
          <HardDrive size={32} />
        </div>
        <div className="space-y-2 max-w-sm">
          <h2 className="text-2xl font-bold text-dark-bg dark:text-light-bg">Folder Access Required</h2>
          <p className="text-dark-bg/70 dark:text-light-bg/70 leading-relaxed text-sm">
            For security, your browser requires permission to access your local Vault folder each time you restart the app.
          </p>
        </div>
        <button
          onClick={async () => {
            setAppState('restore-vault'); // show spinner during load
            const success = await handleUnlockVault();
            if (success) {
              setAppState('ready');
            } else {
              setAppState('needs-vault-permission');
            }
          }}
          className="px-6 py-3 rounded-lg text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 transition-colors shadow-lg shadow-indigo-500/25"
        >
          Grant Folder Access
        </button>
        <button
          onClick={() => {
            disconnectDropbox(); // Safety reset
            setStorageMode('unset');
            setAppState('welcome');
          }}
          className="text-sm text-dark-bg/50 dark:text-light-bg/50 hover:text-dark-bg dark:hover:text-light-bg transition-colors"
        >
          Choose different storage
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden relative">
      <Sidebar
        selectedNoteId={selectedNoteId}
        onSelectNote={handleSelectNote}
        isOpen={isSidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onOpenSettings={() => {
          setSettingsTab('general');
          setSidebarOpen(false);
          setIsSettingsOpen(true);
        }}
        storageMode={storageMode}
        syncStatus={syncStatus}
        lastSyncTime={lastSyncTime}
        onSync={doSync}
        onAddNote={handleAddNote}
        onAddFolder={handleAddFolder}
        isVaultLocked={isVaultLocked}
        onUnlockVault={handleUnlockVault}
        onDeleteItem={(id: number) => {
          if (id === selectedNoteId) setSelectedNoteId(null);
        }}
      />

      <Suspense fallback={null}>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          initialTab={settingsTab}
          theme={theme}
          setTheme={setTheme}
          onChangeVault={handlePickVault}
          onSwitchToBrowserStorage={handleUseBrowserStorage}
          onSyncStatusChange={(connected) => setSyncStatus(connected ? 'idle' : 'disconnected')}
          onInstallPWA={installPrompt ? handleInstallPWA : undefined}
          storageMode={storageMode}
        />

        {/* Render Universal Search Palette */}
        {appState === 'ready' && (
          <CommandPalette
            onSelectNote={(id) => {
              handleSelectNote(id);
            }}
          />
        )}
      </Suspense>

      {/* Render Cloud Sync Prompt */}
      {appState === 'ready' && syncStatus === 'disconnected' && (
        <CloudSyncPrompt
          onConnect={() => {
            setSettingsTab('sync');
            setIsSettingsOpen(true);
          }}
        />
      )}



      <button
        onClick={() => setSidebarOpen(!isSidebarOpen)}
        className="fixed z-[60] p-2.5 bg-light-bg/70 dark:bg-dark-bg/70 backdrop-blur-md border border-dark-bg/5 dark:border-light-bg/5 shadow-sm hover:bg-light-ui dark:hover:bg-dark-ui rounded-full text-dark-bg dark:text-light-bg transition-all"
        style={{
          top: 'calc(1rem + var(--spacing-safe-top, 0px))',
          left: 'calc(1rem + var(--spacing-safe-left, 0px))'
        }}
        aria-label="Toggle Sidebar"
      >
        <PanelLeft size={22} />
      </button>

      <main className={`flex-1 flex flex-col h-full w-full overflow-hidden relative transition-all duration-300 ease-in-out ${isSidebarOpen ? 'md:ml-64' : 'ml-0'}`}>
        <div className="flex-1 flex flex-col overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {selectedNoteId ? (
              <motion.div
                key={selectedNoteId}
                className="flex-1 flex flex-col h-full overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: 'easeInOut' }}
              >
                <Suspense fallback={<div className="flex-1 w-full h-full flex items-center justify-center"><FallbackSpinner /></div>}>
                  <Editor
                    noteId={selectedNoteId}
                    isVaultLocked={isVaultLocked}
                    onUnlockVault={handleUnlockVault}
                    onSelectNote={handleSelectNote}
                    syncStatus={syncStatus}
                    lastSyncTime={lastSyncTime}
                  />
                </Suspense>
              </motion.div>
            ) : (
              <motion.div
                key="empty-state"
                className="flex h-full flex-col items-center justify-center p-6 text-center"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                <div className="w-24 h-24 mb-8 text-dark-bg/5 dark:text-light-bg/5 relative">
                  <FileText size={96} strokeWidth={1} className="absolute inset-0" />
                  <div className="absolute inset-x-0 bottom-0 top-1/2 bg-gradient-to-t from-light-bg dark:from-dark-bg to-transparent" />
                </div>
                <div className="space-y-2 max-w-sm">
                  <h3 className="text-xl font-bold text-dark-bg dark:text-light-bg tracking-tight">Focus on your ideas</h3>
                  <p className="text-dark-bg/40 dark:text-light-bg/40 text-sm leading-relaxed">
                    Select a note from the sidebar or press <kbd className="font-sans px-1.5 py-0.5 bg-dark-bg/5 dark:bg-light-bg/5 border border-dark-bg/10 dark:border-light-bg/10 rounded-md text-xs font-bold">Alt + N</kbd> to start something new.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Render Navigation Dock inside workspace for perfect centering */}
        {appState === 'ready' && (
          <NavigationDock
            onAddNote={() => handleAddNote(0)}
            onAddFolder={() => handleAddFolder(0)}
            isSidebarOpen={isSidebarOpen}
            syncStatus={syncStatus}
            onSync={doSync}
          />
        )}
      </main>

      {/* Global Modals */}
      <Suspense fallback={null}>
        {smartPopupState.isOpen && smartPopupState.folderId && (
            <SmartFolderPopup
                folderId={smartPopupState.folderId}
                folderTitle={smartPopupState.folderTitle || ''}
                onClose={() => setSmartPopupState({ isOpen: false })}
            />
        )}
      </Suspense>
    </div>
  );
}

export default App;
