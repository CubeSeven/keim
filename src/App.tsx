import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import { db, addItem, getFullPath } from './lib/db';
import { PanelLeft } from 'lucide-react';
import SettingsModal from './components/SettingsModal';
import WelcomeScreen from './components/WelcomeScreen';
import { authorizeDropbox, syncNotesWithDrive, isDriveConnected, initSync } from './lib/sync';
import {
  getStorageMode, setStorageMode,
  openVaultPicker, restoreVaultHandle, getVaultName,
  readVaultTree, readNoteContent
} from './lib/vault';
import { CommandPalette } from './components/CommandPalette';
import { buildSearchIndex } from './lib/search';
import MobileDock from './components/MobileDock';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'disconnected';

type AppState = 'loading' | 'welcome' | 'restore-vault' | 'ready';

function App() {
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(() => {
    const savedId = localStorage.getItem('keim_selected_note_id');
    return savedId ? parseInt(savedId, 10) : null;
  });
  const [selectedNotePath, setSelectedNotePath] = useState<string | null>(() => {
    return localStorage.getItem('keim_selected_note_path');
  });
  // Ref so loadVaultIntoDb can read the latest selected path without being a reactive dep.
  const selectedNotePathRef = useRef<string | null>(selectedNotePath);
  useEffect(() => { selectedNotePathRef.current = selectedNotePath; }, [selectedNotePath]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    return localStorage.getItem('keim_sidebar_open') === 'true';
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    if (selectedNoteId !== null) {
      localStorage.setItem('keim_selected_note_id', selectedNoteId.toString());
      // Recompute and store the path when ID changes
      db.items.toArray().then(items => {
        const item = items.find(i => i.id === selectedNoteId);
        if (item) {
          const path = getFullPath(selectedNoteId, items);
          const fullPath = path ? `${path}/${item.title}` : item.title;
          localStorage.setItem('keim_selected_note_path', fullPath);
          setSelectedNotePath(fullPath);
        }
      });
    } else {
      localStorage.removeItem('keim_selected_note_id');
      localStorage.removeItem('keim_selected_note_path');
      setSelectedNotePath(null);
    }
  }, [selectedNoteId]);

  useEffect(() => {
    localStorage.setItem('keim_sidebar_open', isSidebarOpen.toString());
  }, [isSidebarOpen]);

  // --- PWA Installation ---
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => void, userChoice: Promise<{ outcome: string }> } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as unknown as { prompt: () => void, userChoice: Promise<{ outcome: string }> });
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallPWA = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    console.log(`PWA install outcome: ${outcome}`);
    setInstallPrompt(null);
  };
  const [appState, setAppState] = useState<AppState>('loading');
  const [isPickingVault, setIsPickingVault] = useState(false);
  const [vaultName, setVaultName] = useState<string>('');
  // Sidebar key forces re-render when vault loads new notes
  const [sidebarKey, setSidebarKey] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(() => {
    return Number(localStorage.getItem('keim_last_sync')) || null;
  });
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
    const isDark = currentTheme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : currentTheme === 'dark';

    root.classList.add(isDark ? 'dark' : 'light');

    // Update theme-color meta tag for Android navigation bar / status bar
    const color = isDark ? '#1C1B21' : '#FEFEFE';
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
      meta.setAttribute('content', color);
    });
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

    // Build absolute paths index for existing Dexie items
    const existingItems = await db.items.toArray();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingMap = new Map<string, any>(); // Map vault path to existing db item

    // Helper to resolve an item's full vault path from Dexie parentIds
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buildPath = (item: any): string => {
      const parentPath = getFullPath(item.parentId, existingItems);
      return parentPath ? `${parentPath}/${item.title}` : item.title;
    };

    existingItems.forEach(item => {
      if (!item.isDeleted) {
        existingMap.set(buildPath(item), item);
      }
    });

    const currentVaultPaths = new Set<string>();

    // Index folder paths -> DB ids
    const folderPathToId = new Map<string, number>();
    folderPathToId.set('', 0); // root

    // Insert or update folders first (sorted by depth so parents come before children)
    const sortedFolders = [...tree.folders].sort((a, b) => {
      const depthA = a.path.split('/').length;
      const depthB = b.path.split('/').length;
      return depthA - depthB;
    });

    for (const folder of sortedFolders) {
      currentVaultPaths.add(folder.path);
      const parentId = folderPathToId.get(folder.parentPath) ?? 0;
      const existingFolder = existingMap.get(folder.path);

      if (existingFolder && existingFolder.type === 'folder') {
        folderPathToId.set(folder.path, existingFolder.id);
        // Ensure parentId is correct if it was somehow moved
        if (existingFolder.parentId !== parentId) {
          await db.items.update(existingFolder.id, { parentId });
        }
      } else {
        const id = await db.items.add({
          parentId, type: 'folder', title: folder.name,
          updated_at: Date.now()
        });
        folderPathToId.set(folder.path, id as number);
      }
    }

    // Insert or update notes
    for (const note of tree.notes) {
      currentVaultPaths.add(note.path);
      const parentId = folderPathToId.get(note.parentPath) ?? 0;
      const existingNote = existingMap.get(note.path);
      let noteId: number;

      if (existingNote && existingNote.type === 'note') {
        noteId = existingNote.id;
        // Content-based change detection: only bump updated_at when content ACTUALLY differs.
        // Never use OS file.lastModified as the sync clock — it causes phantom re-uploads.
        try {
          const vaultContent = await readNoteContent(note.path);
          const dexieContent = await db.contents.get(noteId);
          const hasContentChanged = dexieContent?.content !== vaultContent;
          if (hasContentChanged) {
            await db.contents.put({ id: noteId, content: vaultContent });
            // Use the file's real lastModified time so sync can correctly
            // compare it against the cloud version's timestamp.
            await db.items.update(noteId, { updated_at: note.updatedAt, parentId });
          } else if (existingNote.parentId !== parentId) {
            // Only update structural location, do NOT touch updated_at
            await db.items.update(noteId, { parentId });
          }
        } catch (e) { console.warn('Failed to read vault content for comparison:', note.path, e); }
      } else {
        // Net-new note found in Vault — use the file's real lastModified
        // timestamp so that Dropbox sync will correctly identify whether
        // the cloud copy is newer and should overwrite this one.
        noteId = (await db.items.add({
          parentId, type: 'note', title: note.title,
          updated_at: note.updatedAt
        })) as number;

        try {
          const content = await readNoteContent(note.path);
          await db.contents.add({ id: noteId, content });
        } catch {
          await db.contents.add({ id: noteId, content: '' });
        }
      }
    }

    // Handle Deletions: if an item exists in Dexie (non-deleted) but NOT in the Vault,
    // it was deleted from disk. Mark it deleted so the tombstone syncs to Dropbox.
    for (const [path, existingItem] of existingMap.entries()) {
      if (!currentVaultPaths.has(path) && !existingItem.isDeleted) {
        await db.items.update(existingItem.id, { isDeleted: true, updated_at: Date.now() });
      }
    }

    // Attempt to restore selected note ID from path
    const storedPath = selectedNotePathRef.current;
    if (storedPath) {
      const items = await db.items.toArray();
      const matchedNode = items.find(item => {
        if (item.type !== 'note') return false;
        const parentPathStr = getFullPath(item.id!, items);
        const fullPathStr = parentPathStr ? `${parentPathStr}/${item.title}` : item.title;
        return fullPathStr === storedPath;
      });
      if (matchedNode) {
        setSelectedNoteId(matchedNode.id!);
      } else {
        setSelectedNoteId(null);
      }
    }

    // Empty dep array: this function never changes. It reads selectedNotePath via the ref.
  }, []);

  // --- App Startup Logic ---
  useEffect(() => {
    async function init() {
      // 1. Request Persistent Storage (if supported)
      if (navigator.storage && navigator.storage.persist) {
        try {
          const isPersisted = await navigator.storage.persist();
          console.log(`Persistent storage granted: ${isPersisted}`);
        } catch (e) {
          console.warn('Could not request persistent storage', e);
        }
      }

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
    init().then(() => {
      // Build search index after db is ready
      buildSearchIndex().catch(console.error);
    }).catch(console.error);
  }, [loadVaultIntoDb]);

  // Listen for background auto-sync status updates, authorize Dropbox, and kick off one initial sync.
  useEffect(() => {
    initSync(); // Sets up interval polling and visibility-change listener

    const handleSyncStatus = (e: Event) => {
      const status = (e as CustomEvent).detail as SyncStatus;
      setSyncStatus(status);
      if (status === 'synced') {
        const time = localStorage.getItem('keim_last_sync');
        if (time) setLastSyncTime(Number(time));
      }
    };

    const handleSyncComplete = () => {
      buildSearchIndex().catch(console.error);
    };

    window.addEventListener('keim_sync_status', handleSyncStatus);
    window.addEventListener('keim_sync_complete', handleSyncComplete);

    // Authorize Dropbox silently (no redirect), then fire ONE background sync if connected.
    authorizeDropbox().then(async (connected) => {
      setSyncStatus(connected ? 'idle' : 'disconnected');
      if (connected) {
        // Small delay so the UI is fully mounted before we start syncing
        await new Promise(r => setTimeout(r, 1000));
        try {
          await syncNotesWithDrive(true /* background */);
        } catch (e) {
          console.warn('Initial background sync failed', e);
        }
      }
    }).catch(console.error);

    return () => {
      window.removeEventListener('keim_sync_status', handleSyncStatus);
      window.removeEventListener('keim_sync_complete', handleSyncComplete);
    };
  }, []);

  // Expose a doSync helper that updates status
  const doSync = useCallback(async () => {
    if (!isDriveConnected()) {
      setSyncStatus('disconnected');
      return;
    }
    // syncStatus is now managed by the keim_sync_status event fired by syncNotesWithDrive
    try {
      await syncNotesWithDrive(false);
    } catch (e) {
      const error = e as Error;
      console.error(error);
      if (error && error.message && error.message.includes("authentication expired")) {
        alert("Your Dropbox session has expired or is invalid. Please go to Settings and sign in again.");
      }
    }
  }, []);

  // --- Seed IndexedDB (for browser storage mode) ---
  async function seedIndexedDb() {
    const count = await db.items.count();
    // Only seed if the database is completely empty — never wipe existing notes
    if (count > 0) {
      localStorage.setItem('notes_seeded_v2', 'true');
      localStorage.setItem('keim_has_user_edits', 'true'); // Real notes exist — never treat as untouched defaults
      return;
    }
    const hasSeeded = localStorage.getItem('notes_seeded_v2');
    if (hasSeeded) return; // Already seeded, DB must have been manually cleared

    localStorage.setItem('notes_seeded_v2', 'true');

    const folderId = await addItem({ parentId: 0, type: 'folder', title: '🚀 Getting Started' });
    await addItem({ parentId: folderId, type: 'note', title: 'Welcome to Keim Notes' },
      '# Welcome to Keim Notes\n\nLocal-first, high-performance notes.\n\n**Features:**\n- Hierarchical folders\n- Markdown editing (Milkdown)\n- PWA — works offline\n- Optional Dropbox sync');
    await addItem({ parentId: folderId, type: 'note', title: 'Cloud Sync Guide' },
      '# Cloud Sync\n\n1. Open Settings.\n2. Click "Sign in with Dropbox".\n3. That\'s it!');
    await addItem({ parentId: 0, type: 'note', title: 'Quick Scratchpad' }, 'Use this for quick thoughts.');

    // Flag these as untouched default notes
    localStorage.setItem('keim_has_user_edits', 'false');
  }

  // --- Global Creation Handlers ---
  const handleAddNote = async (parentId = 0) => {
    const id = await addItem({ parentId, type: 'note', title: 'New Note' }, '');
    localStorage.setItem('keim_has_user_edits', 'true');
    setSelectedNoteId(id as number);
    if (window.innerWidth < 768) setIsSidebarOpen(false);

    const tryFocus = () => window.dispatchEvent(new CustomEvent('keim_focus_title', { detail: id }));
    setTimeout(tryFocus, 50);
    setTimeout(tryFocus, 150);
    setTimeout(tryFocus, 300);
  };

  const handleAddFolder = async (parentId = 0) => {
    const id = await addItem({ parentId, type: 'folder', title: 'New Folder' }, '');
    localStorage.setItem('keim_has_user_edits', 'true');
    if (window.innerWidth < 768) setIsSidebarOpen(true);

    // Rename node
    const tryRename = () => window.dispatchEvent(new CustomEvent('keim_rename_node', { detail: id }));
    setTimeout(tryRename, 50);
    setTimeout(tryRename, 150);
    setTimeout(tryRename, 300);
  };

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
              const { getFullPath } = await import('./lib/db');
              const { notePathFromTitle } = await import('./lib/vault');
              const contents = await db.contents.toArray();
              const items = await db.items.toArray();
              const contentMap = new Map(contents.map(c => [c.id, c.content]));

              for (const item of items) {
                if (item.type === 'note' && !item.isDeleted) {
                  const content = contentMap.get(item.id!) || '';
                  const parentPath = getFullPath(item.id!, items);
                  const path = notePathFromTitle(item.title, parentPath);
                  // Write directly to the picked handle
                  const parts = path.split('/');
                  let dir: FileSystemDirectoryHandle = handle;
                  for (let i = 0; i < parts.length - 1; i++) {
                    dir = await dir.getDirectoryHandle(parts[i], { create: true });
                  }
                  const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const writable = await (fileHandle as any).createWritable();
                  await writable.write(content);
                  await writable.close();
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
        lastSyncTime={lastSyncTime}
        onSync={doSync}
        onAddNote={handleAddNote}
        onAddFolder={handleAddFolder}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        theme={theme}
        setTheme={setTheme}
        onChangeVault={handlePickVault}
        onSwitchToBrowserStorage={handleUseBrowserStorage}
        onSyncStatusChange={(connected) => setSyncStatus(connected ? 'idle' : 'disconnected')}
        onInstallPWA={installPrompt ? handleInstallPWA : undefined}
      />

      {/* Render Universal Search Palette */}
      {appState === 'ready' && (
        <CommandPalette
          onSelectNote={(id) => {
            setSelectedNoteId(id);
            if (window.innerWidth < 768) setIsSidebarOpen(false);
          }}
        />
      )}

      {/* Render Mobile Dock */}
      {appState === 'ready' && !isSidebarOpen && (
        <MobileDock
          onAddNote={() => handleAddNote(0)}
          onAddFolder={() => handleAddFolder(0)}
        />
      )}

      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="fixed z-[60] p-2.5 bg-light-bg/80 dark:bg-dark-bg/80 backdrop-blur-md border border-dark-bg/5 dark:border-light-bg/5 shadow-sm hover:bg-light-ui dark:hover:bg-dark-ui rounded-full text-dark-bg dark:text-light-bg transition-all"
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
