import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import { db, addItem } from './lib/db';
import { Menu } from 'lucide-react';
import SettingsModal from './components/SettingsModal';
import WelcomeScreen from './components/WelcomeScreen';
import SyncProgressModal from './components/SyncProgressModal';
import { authorizeDropbox, syncNotesWithDrive, isDriveConnected, type SyncProgress } from './lib/sync';
import {
  getStorageMode, setStorageMode,
  openVaultPicker, restoreVaultHandle, getVaultName,
  readVaultTree, readNoteContent
} from './lib/vault';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'disconnected';

type AppState = 'loading' | 'welcome' | 'restore-vault' | 'ready';

function App() {
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [appState, setAppState] = useState<AppState>('loading');
  const [isPickingVault, setIsPickingVault] = useState(false);
  const [vaultName, setVaultName] = useState<string>('');
  // Sidebar key forces re-render when vault loads new notes
  const [sidebarKey, setSidebarKey] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const storageMode = getStorageMode(); // sync call — safe since we re-render on appState changes

  // --- Theme ---
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(() => {
    const stored = localStorage.getItem('keim_theme') as 'light' | 'dark' | 'system';
    return stored || 'system';
  });

  const setTheme = (newTheme: 'light' | 'dark' | 'system') => {
    setThemeState(newTheme);
    localStorage.setItem('keim_theme', newTheme);
    applyTheme(newTheme);
  };

  const applyTheme = (currentTheme: 'light' | 'dark' | 'system') => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    if (currentTheme === 'system') {
      root.classList.add(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    } else {
      root.classList.add(currentTheme);
    }
  };

  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (theme === 'system') applyTheme('system'); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // --- Load Vault Tree into IndexedDB mirror ---
  const loadVaultIntoDb = useCallback(async () => {
    const tree = await readVaultTree();
    if (!tree) return;

    await db.items.clear();
    await db.contents.clear();

    // Index folder paths -> DB ids
    const folderPathToId = new Map<string, number>();
    folderPathToId.set('', 0); // root

    // Insert folders first (sorted by depth so parents come before children)
    const sortedFolders = [...tree.folders].sort((a, b) => {
      const depthA = a.path.split('/').length;
      const depthB = b.path.split('/').length;
      return depthA - depthB;
    });

    for (const folder of sortedFolders) {
      const parentId = folderPathToId.get(folder.parentPath) ?? 0;
      const id = await db.items.add({
        parentId, type: 'folder', title: folder.name,
        updated_at: Date.now()
      });
      folderPathToId.set(folder.path, id as number);
    }

    // Insert notes
    for (const note of tree.notes) {
      const parentId = folderPathToId.get(note.parentPath) ?? 0;
      const id = await db.items.add({
        parentId, type: 'note', title: note.title,
        updated_at: note.updatedAt
      });
      // Read content lazily — store to IndexedDB for editor access
      try {
        const content = await readNoteContent(note.path);
        await db.contents.add({ id: id as number, content });
      } catch {
        await db.contents.add({ id: id as number, content: '' });
      }
    }
  }, []);

  // --- App Startup Logic ---
  useEffect(() => {
    async function init() {
      const mode = getStorageMode();

      if (mode === 'unset') {
        setAppState('welcome');
        return;
      }

      if (mode === 'vault') {
        setAppState('restore-vault');
        const handle = await restoreVaultHandle();
        if (handle) {
          await loadVaultIntoDb();
          setVaultName(getVaultName());
          setAppState('ready');
          setSidebarKey(k => k + 1);
        } else {
          // Couldn't restore (permission denied), go to welcome
          setAppState('welcome');
        }
        return;
      }

      // IndexedDB mode
      setAppState('ready');
      await seedIndexedDb();
    }
    init().catch(console.error);
  }, [loadVaultIntoDb]);

  // Handle Dropbox redirect back + initialize sync status
  useEffect(() => {
    authorizeDropbox().then((connected) => {
      setSyncStatus(connected ? 'idle' : 'disconnected');
    }).catch(console.error);
  }, []);

  // Expose a doSync helper that updates status
  const doSync = useCallback(async () => {
    if (!isDriveConnected()) {
      setSyncStatus('disconnected');
      return;
    }
    setSyncStatus('syncing');
    try {
      await syncNotesWithDrive(false, (p) => setSyncProgress(p));
      setSyncStatus('synced');
      // After a short while, revert to idle and hide progress
      setTimeout(() => {
        setSyncStatus('idle');
        setSyncProgress(null);
      }, 2000);
    } catch {
      setSyncStatus('error');
      setSyncProgress(null);
    }
  }, []);

  // --- Seed IndexedDB (for browser storage mode) ---
  async function seedIndexedDb() {
    const count = await db.items.count();
    const hasSeeded = localStorage.getItem('notes_seeded_v2');
    if (hasSeeded && count > 0) return;

    localStorage.setItem('notes_seeded_v2', 'true');
    await db.items.clear();
    await db.contents.clear();

    const folderId = await addItem({ parentId: 0, type: 'folder', title: '🚀 Getting Started' });
    await addItem({ parentId: folderId, type: 'note', title: 'Welcome to Keim Notes' },
      '# Welcome to Keim Notes\n\nLocal-first, high-performance notes.\n\n**Features:**\n- Hierarchical folders\n- Markdown editing (Milkdown)\n- PWA — works offline\n- Optional Dropbox sync');
    await addItem({ parentId: folderId, type: 'note', title: 'Cloud Sync Guide' },
      '# Cloud Sync\n\n1. Open Settings.\n2. Click "Sign in with Dropbox".\n3. That\'s it!');
    await addItem({ parentId: 0, type: 'note', title: 'Quick Scratchpad' }, 'Use this for quick thoughts.');
  }

  // --- Welcome Screen Handlers ---
  const handlePickVault = async () => {
    setIsPickingVault(true);
    try {
      const handle = await openVaultPicker();
      if (handle) {
        // --- Migration Check ---
        const currentMode = getStorageMode();
        if (currentMode !== 'vault') {
          const count = await db.items.count();
          if (count > 0) {
            const wantsMerge = window.confirm(
              "You have existing browser notes. Do you want to copy them into your new Vault folder?\n\nClick OK to Merge, or Cancel to start fresh."
            );
            if (wantsMerge) {
              // Quick export directly to the newly picked handle
              const contents = await db.contents.toArray();
              const items = await db.items.toArray();
              const contentMap = new Map(contents.map(c => [c.id, c.content]));

              // Recursive path builder
              const getFullPath = (itemId: number, allItems: any[]): string => {
                const item = allItems.find(i => i.id === itemId);
                if (!item || item.parentId === 0) return "";
                const parentPath = getFullPath(item.parentId, allItems);
                const parent = allItems.find(i => i.id === item.parentId);
                if (!parent) return "";
                return parentPath ? `${parentPath}/${parent.title}` : parent.title;
              };

              // Note file writer
              const writeNote = async (notePath: string, content: string) => {
                const parts = notePath.split('/');
                let dir = handle;
                for (let i = 0; i < parts.length - 1; i++) {
                  dir = await dir.getDirectoryHandle(parts[i], { create: true });
                }
                const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
                const writable = await (fileHandle as any).createWritable();
                await writable.write(content);
                await writable.close();
              };

              // Execute move
              for (const item of items) {
                if (item.type === 'note' && !item.isDeleted) {
                  const content = contentMap.get(item.id!) || '';
                  const parentPath = getFullPath(item.id!, items);
                  // notePathFromTitle equivalent
                  const safeName = item.title.replace(/[<>:"/\\|?*]/g, '_') + '.md';
                  const path = parentPath ? `${parentPath}/${safeName}` : safeName;
                  await writeNote(path, content);
                }
              }
            }
          }
        }
        // -----------------------

        await loadVaultIntoDb();
        setVaultName(getVaultName());
        setAppState('ready');
        setSidebarKey(k => k + 1);
      }
    } finally {
      setIsPickingVault(false);
    }
  };

  const handleUseBrowserStorage = async () => {
    setStorageMode('indexeddb');
    await seedIndexedDb();
    setAppState('ready');
    setSidebarKey(k => k + 1);
  };

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
      <WelcomeScreen
        onPickVault={handlePickVault}
        onUseBrowserStorage={handleUseBrowserStorage}
        isPickingVault={isPickingVault}
      />
    );
  }

  if (appState === 'restore-vault') {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-light-bg dark:bg-dark-bg gap-4 p-6 text-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        <p className="text-dark-bg/70 dark:text-light-bg/70">Reconnecting to your vault...</p>
        <p className="text-dark-bg/40 dark:text-light-bg/40 text-sm">Your browser may ask for permission.</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden relative">
      <Sidebar
        key={sidebarKey}
        selectedNoteId={selectedNoteId}
        onSelectNote={(id: number) => {
          setSelectedNoteId(id);
          if (window.innerWidth < 768) setIsSidebarOpen(false);
        }}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onOpenSettings={() => {
          setIsSidebarOpen(false);
          setIsSettingsOpen(true);
        }}
        vaultName={vaultName}
        storageMode={storageMode}
        syncStatus={syncStatus}
        onSync={doSync}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        onChangeVault={handlePickVault}
        onSwitchToBrowserStorage={handleUseBrowserStorage}
      />

      <SyncProgressModal
        progress={syncProgress}
        onClose={() => setSyncProgress(null)}
      />

      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="fixed top-3 left-3 z-[60] p-2 hover:bg-light-ui dark:hover:bg-dark-ui rounded-lg text-dark-bg dark:text-light-bg transition-colors"
        aria-label="Toggle Sidebar"
      >
        <Menu size={20} />
      </button>

      <main className={`flex-1 flex flex-col h-full w-full overflow-hidden relative transition-all duration-300 ease-in-out ${isSidebarOpen ? 'md:ml-64' : 'ml-0'}`}>
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedNoteId ? (
            <Editor key={selectedNoteId} noteId={selectedNoteId} />
          ) : (
            <div className="flex h-full items-center justify-center text-dark-bg/50 dark:text-light-bg/50 p-6 text-center">
              <p>Select a note from the sidebar or create a new one.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
