import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../lib/db';
import { getStorageMode, setStorageMode, openVaultPicker, restoreVaultHandle, hasSavedVault, loadVaultIntoDb } from '../lib/vault';
import { initSync, disconnectDropbox, authorizeDropbox, syncNotesWithDrive, isDriveConnected } from '../lib/sync';
import { buildSearchIndex } from '../lib/search';
import { useAppStore } from '../store';
import type { SyncStatus } from '../App';
import type { AppStateStatus } from '../store';
import { KEYS } from '../lib/constants';

export function useAppInit() {
    const { 
        setSelectedNoteId,
        selectedNotePath,
        setIsVaultLocked, setSyncStatus, setLastSyncTime 
    } = useAppStore();

    const [appState, setAppState] = useState<AppStateStatus>('loading');
    const [isPickingVault, setIsPickingVault] = useState(false);
    const [installPrompt, setInstallPrompt] = useState<{ prompt: () => void, userChoice: Promise<{ outcome: string }> } | null>(null);
    const [confirmMergeState, setConfirmMergeState] = useState<{ isOpen: boolean; resolve: ((v: boolean) => void) | null }>({ isOpen: false, resolve: null });
    
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
    const doLoadVaultIntoDb = useCallback(async () => {
        await loadVaultIntoDb(selectedNotePathRef.current, setSelectedNoteId);
    }, [setSelectedNoteId]);

    // --- Seed IndexedDB ---
    async function seedIndexedDb() {
        const count = await db.items.count();
        if (count > 0) {
            localStorage.setItem(KEYS.SEEDED_V2, 'true');
            localStorage.setItem(KEYS.HAS_USER_EDITS, 'true');
            return;
        }
        if (localStorage.getItem(KEYS.SEEDED_V2)) return;

        localStorage.setItem(KEYS.SEEDED_V2, 'true');
        const { addItem } = await import('../lib/db');
        const folderId = await addItem({ parentId: 0, type: 'folder', title: '🚀 Getting Started' });
        await addItem({ parentId: folderId, type: 'note', title: 'Welcome to Keim Notes' }, '# Welcome to Keim Notes\n\nLocal-first, high-performance notes.\n\n**Features:**\n- Hierarchical folders\n- Markdown editing (Milkdown)\n- PWA — works offline\n- Optional Dropbox sync');
        await addItem({ parentId: folderId, type: 'note', title: 'Cloud Sync Guide' }, '# Cloud Sync\n\n1. Open Settings.\n2. Click "Sign in with Dropbox".\n3. That\'s it!');
        await addItem({ parentId: 0, type: 'note', title: 'Quick Scratchpad' }, 'Use this for quick thoughts.');

        localStorage.setItem(KEYS.HAS_USER_EDITS, 'false');
    }

    // --- Sync Observers ---
    useEffect(() => {
        initSync();
        const handleSyncStatus = (e: Event) => {
            const status = (e as CustomEvent).detail as SyncStatus;
            setSyncStatus(status);
            if (status === 'synced') {
                const time = localStorage.getItem(KEYS.LAST_SYNC);
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
            const { type, status, timestamp, downloadedIds } = event.data;
            if (type === 'sync_status') setSyncStatus(status);
            else if (type === 'sync_complete' && timestamp) {
                setLastSyncTime(timestamp);
                // *** THE CRITICAL FIX ***
                // The tab that ran the sync dispatches keim_sync_complete locally,
                // but OTHER tabs only received the BroadcastChannel message.
                // We must re-fire the window event here so that Editor's
                // handleSyncComplete triggers and re-mounts with the fresh DB content.
                window.dispatchEvent(new CustomEvent('keim_sync_complete', {
                    detail: { downloadedIds: downloadedIds ?? [] }
                }));
            }
        };
        channel.addEventListener('message', handler);
        return () => channel.close();
    }, [setSyncStatus, setLastSyncTime]);


    // --- App Init Orchestration ---
    useEffect(() => {
        async function init() {
            // Security Hardening: Never load a plaintext DEK from storage.
            // If we find a wrapped keystore payload locally, prompt the user to unlock it.
            const savedPayload = localStorage.getItem(KEYS.ACTIVE_DEK);
            if (savedPayload && savedPayload.startsWith('{')) {
                useAppStore.getState().setE2eeModalState({ isOpen: true, mode: 'unlock' });
            } else if (savedPayload) {
                // Destroy legacy plaintext keys immediately to close the security hole.
                console.warn('E2EE: Destroying legacy plaintext DEK from local storage.');
                localStorage.removeItem(KEYS.ACTIVE_DEK);
            }

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
                    await doLoadVaultIntoDb();
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
    }, [doLoadVaultIntoDb, setIsVaultLocked]);

    // --- Handlers ---
    const handlePickVault = async () => {
        setIsPickingVault(true);
        try {
            const handle = await openVaultPicker();
            if (handle) {
                const currentMode = getStorageMode();
                if (currentMode !== 'vault') {
                    const hasNotes = (await db.items.count()) > 0;
                    let shouldMerge = false;
                    if (hasNotes) {
                        shouldMerge = await new Promise<boolean>((resolve) => {
                            setConfirmMergeState({ isOpen: true, resolve });
                        });
                        setConfirmMergeState({ isOpen: false, resolve: null });
                    }
                    if (shouldMerge) {
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
                await doLoadVaultIntoDb();
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
            await doLoadVaultIntoDb();
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
        doSync,
        confirmMergeState,
    };
}
