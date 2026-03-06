import { db, type NoteItem } from './db';
import { Dropbox, DropboxAuth } from 'dropbox';
import { writeNoteToVault, deleteNoteFromVault, getStorageMode, notePathFromTitle } from './vault';

export interface SyncProgress {
    current: number;
    total: number;
    status: string;
}

let dbxAuth: DropboxAuth | null = null;
let dbx: Dropbox | null = null;
let lastSyncTime: number | null = Number(localStorage.getItem('keim_last_sync')) || null;

export function isDriveConnected() { return !!dbx; }
export function getLastSyncTime() { return lastSyncTime; }

export function getCustomClientId(): string {
    return localStorage.getItem('keim_dropbox_app_key') || "";
}

export function setCustomClientId(key: string) {
    if (key) {
        localStorage.setItem('keim_dropbox_app_key', key);
    } else {
        localStorage.removeItem('keim_dropbox_app_key');
    }
    dbxAuth = null;
    dbx = null;
    localStorage.removeItem('keim_dropbox_refresh');
}

export function getEffectiveClientId(): string {
    return getCustomClientId() || import.meta.env.VITE_DROPBOX_APP_KEY || "";
}

function getDbxAuth(throwIfMissing = true): DropboxAuth | null {
    if (!dbxAuth) {
        const clientId = getEffectiveClientId();
        if (!clientId) {
            if (throwIfMissing) throw new Error("Missing Dropbox App Key. Please configure it in Settings.");
            return null;
        }
        dbxAuth = new DropboxAuth({ clientId });
    }
    return dbxAuth;
}

function getRedirectUri(): string {
    // On GitHub Pages the path is always /keim/ — hardcode to ensure
    // it exactly matches what is registered in the Dropbox Console.
    if (window.location.hostname === 'cubeseven.github.io') {
        return 'https://CubeSeven.github.io/keim';
    }
    // Locally, use origin + pathname stripped of trailing slash
    return (window.location.origin + window.location.pathname).replace(/\/$/, '');
}

/**
 * Attempt silent auth or handle the PKCE callback code.
 * Returns true if we are successfully authenticated.
 */
export async function authorizeDropbox(): Promise<boolean> {
    const auth = getDbxAuth(false); // Don't throw here, just return false if no key
    if (!auth) return false;

    // 1. Did we just come back from a Dropbox auth redirect?
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
        const verifier = window.sessionStorage.getItem('keim_pkce_verifier');
        if (verifier) {
            auth.setCodeVerifier(verifier);
        }
        try {
            const response = await auth.getAccessTokenFromCode(getRedirectUri(), code);
            const result = response.result as any;
            if (result.refresh_token) {
                localStorage.setItem('keim_dropbox_refresh', result.refresh_token);
                auth.setRefreshToken(result.refresh_token);
            }
            dbx = new Dropbox({ auth });
            window.sessionStorage.removeItem('keim_pkce_verifier');
            window.history.replaceState({}, document.title, window.location.pathname); // clear URL
            return true;
        } catch (e) {
            console.error("Failed to exchange PKCE code for token", e);
            localStorage.removeItem('keim_dropbox_refresh');
        }
    }

    // 2. Do we already have a saved offline refresh token?
    const savedRefresh = localStorage.getItem('keim_dropbox_refresh');
    if (savedRefresh) {
        auth.setRefreshToken(savedRefresh);
        dbx = new Dropbox({ auth });
        return true;
    }

    return false; // User needs to explicitly log in
}

/**
 * Trigger the actual redirect to Dropbox for login.
 */
export async function loginToDropbox() {
    const auth = getDbxAuth(true);
    if (!auth) return; // Should have thrown
    const authUrl = await auth.getAuthenticationUrl(
        getRedirectUri(),
        undefined,
        'code',
        'offline',
        undefined,
        'none',
        true // Enforce PKCE
    );
    window.sessionStorage.setItem('keim_pkce_verifier', auth.getCodeVerifier());
    window.location.href = authUrl.toString();
}

/**
 * Recursively build the path for an item based on its parentId
 */
function getFullPath(itemId: number, allItems: NoteItem[]): string {
    const item = allItems.find(i => i.id === itemId);
    if (!item || item.parentId === 0) return "";

    const parentPath = getFullPath(item.parentId, allItems);
    const parent = allItems.find(i => i.id === item.parentId);

    if (!parent) return "";
    return parentPath ? `${parentPath}/${parent.title}` : parent.title;
}

// -----------------------------------------------------------------------------
// V2 Granular Sync Architecture (Dropbox)
// -----------------------------------------------------------------------------

interface SyncManifest {
    lastUpdated: number;
    items: {
        [id: number]: {
            updated_at: number;
            isDeleted: boolean;
        }
    }
}

export async function syncNotesWithDrive(background = false, onProgress?: (p: SyncProgress) => void) {
    const isAuthorized = await authorizeDropbox();
    if (!isAuthorized) {
        if (background) return; // Do not interrupt with popup if background syncing
        await loginToDropbox(); // Redirect if missing tokens entirely
        return;
    }

    if (!dbx) return; // Paranoia check

    if (!navigator.onLine) {
        throw new Error("Network offline. Please check your connection.");
    }

    const storageMode = getStorageMode();

    try {
        console.log("Starting Dropbox Sync V2...");
        if (onProgress) onProgress({ current: 0, total: 1, status: 'Checking remote...' });

        let remoteManifest: SyncManifest = { lastUpdated: 0, items: {} };
        const manifestBlob = await downloadAppFile('/manifest.json');

        if (manifestBlob) {
            const text = await manifestBlob.text();
            try { remoteManifest = JSON.parse(text); } catch (e) { console.warn("Failed to parse remote manifest", e); }
        }

        const localItems = await db.items.toArray();
        const localMap = new Map<number, NoteItem>();
        localItems.forEach(item => {
            if (item.id !== undefined) localMap.set(item.id, item);
        });

        const toDownload: number[] = [];
        const toUpload: NoteItem[] = [];

        // 1. Diff remote vs local
        for (const [idStr, remoteMeta] of Object.entries(remoteManifest.items)) {
            const id = Number(idStr);
            if (isNaN(id)) continue;
            const localItem = localMap.get(id);
            if (!localItem || (localItem.updated_at !== undefined && remoteMeta.updated_at > localItem.updated_at)) {
                if (!remoteMeta.isDeleted || localItem) toDownload.push(id);
            }
        }

        for (const localItem of localItems) {
            if (localItem.id === undefined) continue;
            const remoteMeta = remoteManifest.items[localItem.id];
            if (!remoteMeta || localItem.updated_at > remoteMeta.updated_at) {
                toUpload.push(localItem);
            }
        }

        const totalTasks = toDownload.length + toUpload.length;
        let completedTasks = 0;

        console.log(`Dropbox Sync V2: ${toDownload.length} to download, ${toUpload.length} to upload.`);

        // 2. Execute Downloads (Sequential to be safe with Dropbox API)
        for (const id of toDownload) {
            if (onProgress) onProgress({ current: completedTasks, total: totalTasks, status: `Downloading ${id}...` });

            const isRemoteDeleted = remoteManifest.items[id]?.isDeleted;
            const existingLocalItem = localMap.get(id);

            if (isRemoteDeleted && existingLocalItem) {
                // Handle remote deletion
                await db.items.update(id, { isDeleted: true, updated_at: Date.now() });
                if (storageMode === 'vault') {
                    try {
                        const parentPath = getFullPath(existingLocalItem.parentId, localItems);
                        const path = notePathFromTitle(existingLocalItem.title, parentPath);
                        await deleteNoteFromVault(path);
                    } catch (e) {
                        console.warn("Failed to delete synced node from vault", e);
                    }
                }
            } else if (!isRemoteDeleted) {
                // Standard download
                const itemBlob = await downloadAppFile(`/items/${id}.json`);
                if (itemBlob) {
                    const item = JSON.parse(await itemBlob.text());
                    await db.items.put(item);
                    if (item.type === 'note' && !item.isDeleted) {
                        const contentBlob = await downloadAppFile(`/contents/${id}.json`);
                        if (contentBlob) {
                            const contentData = JSON.parse(await contentBlob.text());
                            await db.contents.put(contentData);

                            // If in vault mode, also write to disk
                            if (storageMode === 'vault') {
                                try {
                                    const parentPath = getFullPath(item.id!, await db.items.toArray());
                                    const path = notePathFromTitle(item.title, parentPath);
                                    await writeNoteToVault(path, contentData.content);
                                } catch (e) {
                                    console.error("Failed to write synced note to vault", e);
                                }
                            }
                        }
                    }
                }
            }
            completedTasks++;
        }

        // 3. Execute Uploads
        for (const item of toUpload) {
            if (onProgress) onProgress({ current: completedTasks, total: totalTasks, status: `Uploading ${item.title}...` });
            await uploadAppFile(`/items/${item.id}.json`, JSON.stringify(item));
            if (item.type === 'note' && !item.isDeleted) {
                const content = await db.contents.get(item.id!);
                if (content) {
                    await uploadAppFile(`/contents/${item.id}.json`, JSON.stringify(content));
                }
            }
            remoteManifest.items[item.id!] = {
                updated_at: item.updated_at,
                isDeleted: !!item.isDeleted
            };
            completedTasks++;
        }

        if (toUpload.length > 0 || toDownload.length > 0) {
            remoteManifest.lastUpdated = Date.now();
            await uploadAppFile('/manifest.json', JSON.stringify(remoteManifest));
        }

        lastSyncTime = Date.now();
        localStorage.setItem('keim_last_sync', lastSyncTime.toString());
        console.log("Dropbox Sync complete!");

    } catch (err) {
        console.error("Dropbox Sync failed:", err);
        throw err;
    }
}

// -----------------------------------------------------------------------------
// Dropbox API Helpers
// -----------------------------------------------------------------------------

async function downloadAppFile(path: string): Promise<Blob | null> {
    if (!dbx) return null;
    try {
        const response = await dbx.filesDownload({ path });
        return (response.result as any).fileBlob;
    } catch (error: any) {
        if (error.status === 409 || error.status === 404) return null;
        throw error;
    }
}

async function uploadAppFile(path: string, content: string) {
    if (!dbx) return;
    await dbx.filesUpload({
        path,
        contents: content,
        mode: { '.tag': 'overwrite' }
    });
}

// -----------------------------------------------------------------------------
// Auto-Sync Debouncer
// -----------------------------------------------------------------------------

let syncTimeout: number | null = null;
let isSyncing = false;

export function triggerAutoSync() {
    if (syncTimeout) window.clearTimeout(syncTimeout);
    syncTimeout = window.setTimeout(async () => {
        if (isSyncing || !dbx) return;
        try {
            isSyncing = true;
            await syncNotesWithDrive(true);
        } catch (e) {
            console.warn("Background sync failed", e);
        } finally {
            isSyncing = false;
        }
    }, 5000);
}
