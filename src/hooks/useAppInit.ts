import { useState, useEffect, useCallback, useRef } from 'react';
import { db, getFullPath, getItemPath } from '../lib/db';
import { readVaultTree, getStorageMode, setStorageMode, openVaultPicker, restoreVaultHandle, readNoteContent, hasSavedVault } from '../lib/vault';
import { initSync, disconnectDropbox, authorizeDropbox, syncNotesWithDrive, isDriveConnected } from '../lib/sync';
import { buildSearchIndex } from '../lib/search';
import { useAppStore } from '../store';
import type { SyncStatus } from '../App';

export type AppState = 'loading' | 'welcome' | 'restore-vault' | 'needs-vault-permission' | 'ready';

export function useAppInit() {
    const { 
        setSelectedNoteId,
        selectedNotePath,
        setIsVaultLocked, setSyncStatus, setLastSyncTime 
    } = useAppStore();

    const [appState, setAppState] = useState<AppState>('loading');
    const [isPickingVault, setIsPickingVault] = useState(false);
    const [installPrompt, setInstallPrompt] = useState<{ prompt: () => void, userChoice: Promise<{ outcome: string }> } | null>(null);
    
    const selectedNotePathRef = useRef<string | null>(selectedNotePath);
    useEffect(() => { selectedNotePathRef.current = selectedNotePath; }, [selectedNotePath]);

    // --- PWA Installation ---
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

    // --- Vault Loading Logic ---
    const loadVaultIntoDb = useCallback(async () => {
        const tree = await readVaultTree();
        if (!tree) return;

        const existingItems = await db.items.toArray();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existingMap = new Map<string, any>(); 

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const buildPath = (item: any): string => {
            const parentPath = getItemPath(item.parentId, existingItems);
            if (item.type === 'note') {
                const safeName = item.title.replace(/[<>:"/\\|?*]/g, '_') + '.md';
                return parentPath ? `${parentPath}/${safeName}` : safeName;
            }
            return parentPath ? `${parentPath}/${item.title}` : item.title;
        };

        existingItems.forEach(item => {
            if (!item.isDeleted) existingMap.set(buildPath(item), item);
        });

        const currentVaultPaths = new Set<string>();
        const folderPathToId = new Map<string, number>();
        folderPathToId.set('', 0); 

        const sortedFolders = [...tree.folders].sort((a, b) => a.path.split('/').length - b.path.split('/').length);

        for (const folder of sortedFolders) {
            currentVaultPaths.add(folder.path);
            const parentId = folderPathToId.get(folder.parentPath) ?? 0;
            const existingFolder = existingMap.get(folder.path);

            if (existingFolder && existingFolder.type === 'folder') {
                folderPathToId.set(folder.path, existingFolder.id);
                if (existingFolder.parentId !== parentId) await db.items.update(existingFolder.id, { parentId });
            } else {
                const id = await db.items.add({ parentId, type: 'folder', title: folder.name, updated_at: Date.now() });
                folderPathToId.set(folder.path, id as number);
            }
        }

        for (const note of tree.notes) {
            currentVaultPaths.add(note.path);
            const parentId = folderPathToId.get(note.parentPath) ?? 0;
            const existingNote = existingMap.get(note.path);
            let noteId: number;

            if (existingNote && existingNote.type === 'note') {
                noteId = existingNote.id;
                try {
                    const vaultContent = await readNoteContent(note.path);
                    const dexieContent = await db.contents.get(noteId);
                    if (dexieContent?.content !== vaultContent) {
                        await db.contents.put({ id: noteId, content: vaultContent });
                        await db.items.update(noteId, { updated_at: note.updatedAt, parentId });
                    } else if (existingNote.parentId !== parentId) {
                        await db.items.update(noteId, { parentId });
                    }
                } catch (e) { console.warn('Failed to read vault content for comparison:', note.path, e); }
            } else {
                noteId = (await db.items.add({ parentId, type: 'note', title: note.title, updated_at: note.updatedAt })) as number;
                try { await db.contents.add({ id: noteId, content: await readNoteContent(note.path) }); } 
                catch { await db.contents.add({ id: noteId, content: '' }); }
            }
        }

        for (const [path, existingItem] of existingMap.entries()) {
            if (!currentVaultPaths.has(path) && !existingItem.isDeleted) {
                await db.items.update(existingItem.id, { isDeleted: true, updated_at: Date.now() });
            }
        }

        try {
            const { reconcileVault } = await import('../lib/vault');
            const allItems = await db.items.toArray();
            const allContents = await db.contents.toArray();
            await reconcileVault(allItems, allContents, getItemPath);
        } catch (e) {
            console.error('Failed to reconcile vault after load:', e);
        }

        const storedPath = selectedNotePathRef.current;
        if (storedPath) {
            const items = await db.items.toArray();
            const matchedNode = items.find(item => {
                if (item.type !== 'note') return false;
                const parentPathStr = getFullPath(item.id!, items);
                const fullPathStr = parentPathStr ? `${parentPathStr}/${item.title}` : item.title;
                return fullPathStr === storedPath;
            });
            setSelectedNoteId(matchedNode ? matchedNode.id! : null);
        }
    }, [setSelectedNoteId]);

    // --- Seed IndexedDB ---
    async function seedIndexedDb() {
        const count = await db.items.count();
        if (count > 0) {
            localStorage.setItem('notes_seeded_v2', 'true');
            localStorage.setItem('keim_has_user_edits', 'true');
            return;
        }
        if (localStorage.getItem('notes_seeded_v2')) return;

        localStorage.setItem('notes_seeded_v2', 'true');
        const { addItem } = await import('../lib/db');
        const folderId = await addItem({ parentId: 0, type: 'folder', title: '🚀 Getting Started' });
        await addItem({ parentId: folderId, type: 'note', title: 'Welcome to Keim Notes' }, '# Welcome to Keim Notes\n\nLocal-first, high-performance notes.\n\n**Features:**\n- Hierarchical folders\n- Markdown editing (Milkdown)\n- PWA — works offline\n- Optional Dropbox sync');
        await addItem({ parentId: folderId, type: 'note', title: 'Cloud Sync Guide' }, '# Cloud Sync\n\n1. Open Settings.\n2. Click "Sign in with Dropbox".\n3. That\'s it!');
        await addItem({ parentId: 0, type: 'note', title: 'Quick Scratchpad' }, 'Use this for quick thoughts.');

        localStorage.setItem('keim_has_user_edits', 'false');
    }

    // --- Sync Observers ---
    useEffect(() => {
        initSync();
        const handleSyncStatus = (e: Event) => {
            const status = (e as CustomEvent).detail as SyncStatus;
            setSyncStatus(status);
            if (status === 'synced') {
                const time = localStorage.getItem('keim_last_sync');
                if (time) setLastSyncTime(Number(time));
            }
        };
        const handleSyncComplete = () => buildSearchIndex().catch(console.error);

        window.addEventListener('keim_sync_status', handleSyncStatus);
        window.addEventListener('keim_sync_complete', handleSyncComplete);

        authorizeDropbox().then(async (connected) => {
            setSyncStatus(connected ? 'idle' : 'disconnected');
            if (connected) {
                await new Promise(r => setTimeout(r, 1000));
                syncNotesWithDrive(true).catch(console.warn);
            }
        }).catch(console.error);

        return () => {
            window.removeEventListener('keim_sync_status', handleSyncStatus);
            window.removeEventListener('keim_sync_complete', handleSyncComplete);
        };
    }, [setSyncStatus, setLastSyncTime]);

    useEffect(() => {
        const channel = new BroadcastChannel('keim_sync');
        const handler = (event: MessageEvent) => {
            const { type, status, timestamp } = event.data;
            if (type === 'sync_status') setSyncStatus(status);
            else if (type === 'sync_complete' && timestamp) setLastSyncTime(timestamp);
        };
        channel.addEventListener('message', handler);
        return () => channel.close();
    }, [setSyncStatus, setLastSyncTime]);

    // --- App Init Orchestration ---
    useEffect(() => {
        async function init() {
            if (navigator.storage && navigator.storage.persist) {
                try { await navigator.storage.persist(); } catch (e) { console.warn('Could not request persistent storage', e); }
            }

            const mode = getStorageMode();
            if (mode === 'unset') {
                disconnectDropbox();
                setAppState('welcome');
                return;
            }

            if (mode === 'vault') {
                if (!await hasSavedVault()) {
                    setAppState('welcome');
                    return;
                }
                setAppState('restore-vault');
                const handle = await restoreVaultHandle(false);
                if (handle) {
                    await loadVaultIntoDb();
                    setAppState('ready');
                } else {
                    setIsVaultLocked(true);
                    setAppState('ready');
                }
                return;
            }

            setAppState('ready');
            await seedIndexedDb();
        }
        init().then(() => buildSearchIndex().catch(console.error)).catch(console.error);
    }, [loadVaultIntoDb, setIsVaultLocked]);

    // --- Handlers ---
    const handlePickVault = async () => {
        setIsPickingVault(true);
        try {
            const handle = await openVaultPicker();
            if (handle) {
                const currentMode = getStorageMode();
                if (currentMode !== 'vault') {
                    if ((await db.items.count()) > 0 && window.confirm("You have existing browser notes. Do you want to copy them into your new Vault folder?\n\nClick OK to Merge, or Cancel to start fresh.")) {
                        const { getItemPath } = await import('../lib/db');
                        const { notePathFromTitle } = await import('../lib/vault');
                        const contents = await db.contents.toArray();
                        const items = await db.items.toArray();
                        const contentMap = new Map(contents.map(c => [c.id, c.content]));

                        for (const item of items) {
                            if (item.type === 'note' && !item.isDeleted) {
                                const content = contentMap.get(item.id!) || '';
                                const parentPath = getItemPath(item.parentId, items);
                                const path = notePathFromTitle(item.title, parentPath);
                                const parts = path.split('/');
                                let dir: FileSystemDirectoryHandle = handle;
                                for (let i = 0; i < parts.length - 1; i++) {
                                    dir = await dir.getDirectoryHandle(parts[i], { create: true });
                                }
                                const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
                                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                                // @ts-ignore - createWritable is not standard everywhere
                                const writable = await fileHandle.createWritable();
                                await writable.write(content);
                                await writable.close();
                            }
                        }
                    }
                }
                await loadVaultIntoDb();
                setAppState('ready');
            }
        } finally {
            setIsPickingVault(false);
        }
    };

    const handleUnlockVault = async () => {
        const handle = await restoreVaultHandle(true);
        if (handle) {
            setIsVaultLocked(false);
            await loadVaultIntoDb();
            syncNotesWithDrive(true).catch(console.warn);
            return true;
        }
        return false;
    };

    const handleUseBrowserStorage = async () => {
        setStorageMode('indexeddb');
        await seedIndexedDb();
        setAppState('ready');
    };

    const doSync = useCallback(async () => {
        if (!isDriveConnected()) {
            setSyncStatus('disconnected');
            return;
        }
        try {
            await syncNotesWithDrive(false);
        } catch (e: unknown) {
            console.error(e);
            if (e instanceof Error && e.message.includes("authentication expired")) {
                alert("Your Dropbox session has expired or is invalid. Please go to Settings and sign in again.");
            }
        }
    }, [setSyncStatus]);

    return {
        appState,
        setAppState,
        isPickingVault,
        installPrompt,
        handleInstallPWA,
        handlePickVault,
        handleUnlockVault,
        handleUseBrowserStorage,
        doSync
    };
}
