import { db, addItem, type NoteItem, getFullPath } from './db';
import { Dropbox, DropboxAuth } from 'dropbox';
import { writeNoteToVault, deleteFromVault, getStorageMode, notePathFromTitle } from './vault';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let dbxAuth: DropboxAuth | null = null;
let dbx: Dropbox | null = null;
let lastSyncTime: number | null = Number(localStorage.getItem('keim_last_sync')) || null;

export function broadcastSyncStatus(status: 'syncing' | 'synced' | 'error' | 'idle' | 'disconnected') {
    window.dispatchEvent(new CustomEvent('keim_sync_status', { detail: status }));
}

const CLIENT_ID = import.meta.env.VITE_DROPBOX_APP_KEY as string;

// All data lives under /keim/ inside the app‑folder so it works regardless of
// whether the Dropbox app is configured as "App Folder" or "Full Dropbox".
const APP_ROOT = '/keim';

export function isDriveConnected() { return !!dbx; }
export function getLastSyncTime() { return lastSyncTime; }

interface DropboxTokenResponse {
    refresh_token?: string;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function getDbxAuth(): DropboxAuth | null {
    if (!dbxAuth) {
        if (!CLIENT_ID) return null;
        dbxAuth = new DropboxAuth({ clientId: CLIENT_ID });
    }
    return dbxAuth;
}

function getRedirectUri(): string {
    if (window.location.hostname === 'cubeseven.github.io') {
        return 'https://CubeSeven.github.io/keim';
    }
    return (window.location.origin + window.location.pathname).replace(/\/$/, '');
}

/**
 * Attempt silent re‑auth from saved refresh token, or handle the PKCE callback.
 * Returns true if we are authenticated after this call.
 */
export async function authorizeDropbox(): Promise<boolean> {
    const auth = getDbxAuth();
    if (!auth) return false;

    // 1. Returning from Dropbox OAuth redirect?
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
        const verifier = window.sessionStorage.getItem('keim_pkce_verifier');
        if (verifier) auth.setCodeVerifier(verifier);
        try {
            const response = await auth.getAccessTokenFromCode(getRedirectUri(), code);
            const result = response.result as unknown as DropboxTokenResponse;
            if (result.refresh_token) {
                localStorage.setItem('keim_dropbox_refresh', result.refresh_token);
                auth.setRefreshToken(result.refresh_token);
            }
            dbx = new Dropbox({ auth });
            window.sessionStorage.removeItem('keim_pkce_verifier');
            window.history.replaceState({}, document.title, window.location.pathname);
            return true;
        } catch (e) {
            console.error('Failed to exchange PKCE code', e);
            localStorage.removeItem('keim_dropbox_refresh');
        }
    }

    // 2. Saved refresh token?
    const savedRefresh = localStorage.getItem('keim_dropbox_refresh');
    if (savedRefresh) {
        auth.setRefreshToken(savedRefresh);
        dbx = new Dropbox({ auth });
        return true;
    }

    return false;
}

/**
 * Redirect the user to Dropbox to begin OAuth PKCE login.
 */
export async function loginToDropbox() {
    const auth = getDbxAuth();
    if (!auth) throw new Error('Dropbox App Key is not configured.');
    const authUrl = await auth.getAuthenticationUrl(
        getRedirectUri(),
        undefined,
        'code',
        'offline',
        undefined,
        'none',
        true // PKCE
    );
    window.sessionStorage.setItem('keim_pkce_verifier', auth.getCodeVerifier());
    window.location.href = authUrl.toString();
}

/**
 * Disconnect: clear tokens and Dropbox client instance.
 */
export function disconnectDropbox() {
    dbxAuth = null;
    dbx = null;
    lastSyncTime = null;
    folderChecked = false;
    lastAuthCheck = 0;
    localStorage.removeItem('keim_dropbox_refresh');
    localStorage.removeItem('keim_last_sync');
}

// ---------------------------------------------------------------------------
// V2 Granular Sync
// ---------------------------------------------------------------------------

interface SyncManifestItem {
    updated_at: number;
    isDeleted: boolean;
    title?: string;      // Added for path-based dedup on fresh devices
    parentPath?: string; // Added for path-based dedup on fresh devices
}

interface SyncManifest {
    lastUpdated: number;
    items: {
        [id: number]: SyncManifestItem;
    }
}

// Cache auth verification — no need to call usersGetCurrentAccount every sync
let lastAuthCheck = 0;
const AUTH_CHECK_TTL = 600000; // 10 minutes

export async function syncNotesWithDrive(background = false) {
    const isAuthorized = await authorizeDropbox();
    if (!isAuthorized) {
        if (background) return;
        await loginToDropbox();
        return;
    }
    if (!dbx) return;

    if (!navigator.onLine) {
        throw new Error('You are offline. Please check your connection.');
    }

    // Only verify the token if it hasn't been checked recently
    if (Date.now() - lastAuthCheck > AUTH_CHECK_TTL) {
        try {
            await dbx.usersGetCurrentAccount();
            lastAuthCheck = Date.now();
        } catch (e) {
            const error = e as { status?: number; response?: { status?: number } };
            const status = error?.status || error?.response?.status;
            if (status === 400 || status === 401) {
                disconnectDropbox();
                broadcastSyncStatus('disconnected');
                throw new Error('Dropbox session expired. Please connect again.');
            }
            throw new Error('Could not reach Dropbox. Please try again.');
        }
    }

    const storageMode = getStorageMode();

    try {
        console.log('Starting Dropbox Sync...');
        broadcastSyncStatus('syncing');

        // Ensure the keim folder exists (silent on conflict)
        await ensureAppFolder();

        // Fetch remote manifest
        let remoteManifest: SyncManifest = { lastUpdated: 0, items: {} };
        const manifestBlob = await downloadAppFile('/manifest.json');
        if (manifestBlob) {
            try { remoteManifest = JSON.parse(await manifestBlob.text()); } catch { /* start fresh */ }
        }

        let localItems = await db.items.toArray();
        const localMap = new Map<number, NoteItem>();
        localItems.forEach(item => { if (item.id !== undefined) localMap.set(item.id, item); });

        // -----------------------------------------------------------------
        // FIRST-SYNC DEDUP & RECONCILIATION
        // On a fresh device, vault-imported notes have different IDs 
        // than the cloud notes. We must reconcile them by PATH.
        // -----------------------------------------------------------------
        const dedupedIds = new Set<number>();
        const collisionsToReassign: NoteItem[] = [];

        if (!lastSyncTime) {
            // Build a path→remoteId map from manifest metadata
            const remotePathMap = new Map<string, number>();
            for (const [idStr, meta] of Object.entries(remoteManifest.items)) {
                if (meta.title && !meta.isDeleted) {
                    const fp = meta.parentPath ? `${meta.parentPath}/${meta.title}` : meta.title;
                    remotePathMap.set(fp, Number(idStr));
                }
            }

            if (remotePathMap.size > 0) {
                // Check if we should warn the user: are there many local files that match cloud paths
                // but have suspicious timestamps (e.g., all recently modified)?
                const pathMatches = localItems.filter(li => {
                    const parentPath = getFullPath(li.id!, localItems);
                    const fullPath = parentPath ? `${parentPath}/${li.title}` : li.title;
                    return remotePathMap.has(fullPath);
                });

                if (pathMatches.length > 0) {
                    const confirm = window.confirm(
                        `Sync Warning: ${pathMatches.length} of your local files match notes already in Dropbox. \n\n` +
                        `Since this is a new setup, we recommend using the versions from your cloud storage to ensure you have the latest content.\n\n` +
                        `Click OK to overwrite local files with cloud versions, or Cancel to keep local versions (may create duplicates).`
                    );

                    if (confirm) {
                        for (const localItem of pathMatches) {
                            if (localItem.id === undefined) continue;
                            console.log(`Dedup: Overwriting local "${localItem.title}" with cloud version.`);
                            await db.items.delete(localItem.id);
                            await db.contents.delete(localItem.id);
                            localMap.delete(localItem.id);
                            dedupedIds.add(localItem.id);
                        }
                        // Refresh local items
                        localItems = await db.items.toArray();
                    }
                }
            }

            // --- ID COLLISION SAFETY (First Sync Only) ---
            // If a local item has an ID that exists in the cloud, but the PATHS don't match,
            // we MUST re-assign the local ID. Otherwise, we might upload this note
            // over a completely unrelated cloud note just because of an ID collision.
            for (const localItem of localItems) {
                if (localItem.id === undefined || localItem.isDeleted || dedupedIds.has(localItem.id)) continue;

                const remoteMeta = remoteManifest.items[localItem.id];
                if (remoteMeta) {
                    // It's an ID collision. Check if it's the SAME note by path.
                    const parentPath = getFullPath(localItem.id, localItems);
                    const localPath = parentPath ? `${parentPath}/${localItem.title}` : localItem.title;
                    const remotePath = remoteMeta.parentPath ? `${remoteMeta.parentPath}/${remoteMeta.title}` : remoteMeta.title;

                    if (localPath !== remotePath) {
                        console.warn(`ID Collision detected for ID #${localItem.id}: Local "${localPath}" vs Cloud "${remotePath}". Re-assigning local ID.`);
                        collisionsToReassign.push({ ...localItem });
                    }
                }
            }

            if (collisionsToReassign.length > 0) {
                for (const item of collisionsToReassign) {
                    const oldId = item.id!;
                    const content = await db.contents.get(oldId);
                    await db.items.delete(oldId);
                    await db.contents.delete(oldId);
                    localMap.delete(oldId);

                    // Re-add to get a new auto-incremented ID
                    const newId = await addItem({
                        parentId: item.parentId,
                        type: item.type,
                        title: item.title,
                        tags: item.tags,
                        icon: item.icon
                    }, content?.content || '', item.updated_at);

                    console.log(`Re-assigned local #${oldId} to #${newId}`);
                }
                // Refresh local items
                localItems = await db.items.toArray();
            }

            // --- ORPHAN FILE HANDLING (First Sync Only) ---
            // If there are local files that don't exist in the cloud at all,
            // they might be "ghosts" from an old vault. Ask user to decide.
            const localOnlyItems = localItems.filter(li => {
                if (li.id === undefined || li.isDeleted || dedupedIds.has(li.id)) return false;
                const parentPath = getFullPath(li.id, localItems);
                const fullPath = parentPath ? `${parentPath}/${li.title}` : li.title;
                return !remotePathMap.has(fullPath);
            });

            if (localOnlyItems.length > 0) {
                const keepOrphans = window.confirm(
                    `New Files Detected: ${localOnlyItems.length} of your local files do not exist in Dropbox.\n\n` +
                    `Do you want to UPLOAD these to Dropbox as new notes?\n\n` +
                    `Click OK to upload them, or Cancel to DISCARD them (recommended if you are restoring an old vault).`
                );

                if (!keepOrphans) {
                    for (const item of localOnlyItems) {
                        console.log(`Sync: Discarding orphan local file "${item.title}"`);
                        await db.items.delete(item.id!);
                        await db.contents.delete(item.id!);
                        dedupedIds.add(item.id!);
                    }
                    // Final refresh
                    localItems = await db.items.toArray();
                }
            }

            localMap.clear();
            localItems.forEach(item => { if (item.id !== undefined) localMap.set(item.id, item); });
        }

        const toDownload: number[] = [];
        const toUpload: NoteItem[] = [];

        // Diff: remote → local
        for (const [idStr, remoteMeta] of Object.entries(remoteManifest.items)) {
            const id = Number(idStr);
            if (isNaN(id)) continue;
            const localItem = localMap.get(id);

            // Remote file has an update
            if (!localItem || (localItem.updated_at !== undefined && remoteMeta.updated_at > localItem.updated_at)) {

                // --- DELETE vs UPDATE CONFLICT ---
                // If remote wants to DELETE but the local copy was updated since last sync,
                // preserve the local update as a "(Recovered)" copy before applying deletion.
                if (remoteMeta.isDeleted && localItem && lastSyncTime && localItem.updated_at > lastSyncTime) {
                    if (localItem.type === 'note') {
                        const localContent = await db.contents.get(localItem.id!);
                        if (localContent) {
                            const recoveredTitle = `${localItem.title} (Recovered)`;
                            const newId = await addItem({
                                parentId: localItem.parentId,
                                type: 'note',
                                title: recoveredTitle
                            }, localContent.content);
                            const newItem = await db.items.get(newId);
                            if (newItem) toUpload.push(newItem);
                            console.warn(`Delete/Update conflict: preserved local update as "${recoveredTitle}"`);
                        }
                    }
                }

                // --- UPDATE vs UPDATE CONFLICT ---
                // If local file was ALSO updated since the last sync, we have a conflict!
                if (localItem && lastSyncTime && localItem.updated_at > lastSyncTime && !remoteMeta.isDeleted) {
                    console.warn(`Conflict detected for note "${localItem.title}"`);

                    // Bail if it's a folder, we only duplicate notes
                    if (localItem.type === 'note') {
                        // 1. Save the local conflicted version as a NEW file
                        const localContent = await db.contents.get(localItem.id!);
                        if (localContent) {
                            const conflictTitle = `${localItem.title} (Local Conflict)`;
                            const newId = await addItem({
                                parentId: localItem.parentId,
                                type: 'note',
                                title: conflictTitle
                            }, localContent.content);

                            // Immediately queue this new conflict file to be uploaded to Dropbox
                            const newItem = await db.items.get(newId);
                            if (newItem) toUpload.push(newItem);

                            console.log(`Created conflicted copy: "${conflictTitle}"`);
                        }
                    }
                }

                if (!remoteMeta.isDeleted || localItem) toDownload.push(id);
            }
        }

        // Diff: local → remote
        for (const localItem of localItems) {
            if (localItem.id === undefined) continue;
            if (dedupedIds.has(localItem.id)) continue; // Already removed as a vault duplicate
            const remoteMeta = remoteManifest.items[localItem.id];

            if (!remoteMeta || localItem.updated_at > remoteMeta.updated_at) {
                // Skip re-uploading a tombstone that is already recorded as deleted in the remote.
                // This prevents an infinite deletion re-upload loop caused by updated_at drift.
                if (localItem.isDeleted && remoteMeta?.isDeleted) continue;

                // Prevent duplicate uploads if we just added it to toUpload during the conflict resolution
                if (!toUpload.find(item => item.id === localItem.id)) {
                    toUpload.push(localItem);
                }
            }
        }

        console.log(`Sync: ${toDownload.length} to download, ${toUpload.length} to upload.`);

        // Downloads - Sequential to prevent half-synced state on partial failure
        for (const id of toDownload) {
            try {
                const isRemoteDeleted = remoteManifest.items[id]?.isDeleted;
                const existingLocal = localMap.get(id);

                if (isRemoteDeleted && existingLocal) {
                    await db.items.update(id, { isDeleted: true, updated_at: Date.now() });
                    // Clean up content for confirmed remote deletions
                    await db.contents.delete(id);
                    if (storageMode === 'vault') {
                        try {
                            const parentPath = getFullPath(existingLocal.parentId, localItems);
                            const path = notePathFromTitle(existingLocal.title, parentPath);
                            await deleteFromVault(path);
                        } catch { /* best‑effort */ }
                    }
                } else if (!isRemoteDeleted) {
                    const itemBlob = await downloadAppFile(`/items/${id}.json`);
                    if (itemBlob) {
                        const item = JSON.parse(await itemBlob.text());

                        // --- VALIDATION: never overwrite with corrupt data ---
                        if (!item || typeof item.id !== 'number' || !item.title || !item.type) {
                            console.error(`Sync: skipping corrupt download for id ${id}`, item);
                            continue;
                        }

                        await db.items.put(item);
                        if (item.type === 'note' && !item.isDeleted) {
                            const contentBlob = await downloadAppFile(`/contents/${id}.json`);
                            if (contentBlob) {
                                const contentData = JSON.parse(await contentBlob.text());

                                // Validate content data
                                if (!contentData || typeof contentData.id !== 'number') {
                                    console.error(`Sync: skipping corrupt content for id ${id}`);
                                    continue;
                                }

                                await db.contents.put(contentData);
                                if (storageMode === 'vault') {
                                    try {
                                        const parentPath = getFullPath(item.id!, await db.items.toArray());
                                        const path = notePathFromTitle(item.title, parentPath);
                                        await writeNoteToVault(path, contentData.content);
                                    } catch (e) { console.error('Failed to write synced note to vault', e); }
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.error(`Sync: download failed for id ${id}, skipping`, e);
                // Continue with remaining downloads instead of aborting the entire sync
            }
        }

        // Uploads - Sequential to avoid 429 "too many write operations"
        for (const item of toUpload) {
            await uploadAppFile(`/items/${item.id}.json`, JSON.stringify(item));
            if (item.type === 'note' && !item.isDeleted) {
                const content = await db.contents.get(item.id!);
                if (content) {
                    await uploadAppFile(`/contents/${item.id}.json`, JSON.stringify(content));
                }
            }
            remoteManifest.items[item.id!] = {
                updated_at: item.updated_at,
                isDeleted: !!item.isDeleted,
                title: item.title,
                parentPath: getFullPath(item.id!, localItems),
            };
        }

        if (toUpload.length > 0 || toDownload.length > 0) {
            remoteManifest.lastUpdated = Date.now();
            await uploadAppFile('/manifest.json', JSON.stringify(remoteManifest));
        }

        lastSyncTime = Date.now();
        localStorage.setItem('keim_last_sync', lastSyncTime.toString());
        console.log('Dropbox Sync complete!');
        broadcastSyncStatus('synced');
        // Tell the UI that content may have changed
        if (toDownload.length > 0) {
            window.dispatchEvent(new CustomEvent('keim_sync_complete', { detail: { downloadedIds: toDownload } }));
        }
        setTimeout(() => broadcastSyncStatus('idle'), 2000);

    } catch (err) {
        console.error('Dropbox Sync failed:', err);
        broadcastSyncStatus('error');
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Dropbox File Helpers
// ---------------------------------------------------------------------------

let folderChecked = false;

async function ensureAppFolder() {
    if (!dbx || folderChecked) return;
    try {
        await dbx.filesCreateFolderV2({ path: APP_ROOT, autorename: false });
    } catch (e) {
        // 409 = folder already exists — that's expected and fine
        const error = e as { status?: number; response?: { status?: number }; error?: { error_summary?: string } };
        const status = error?.status || error?.response?.status;
        const errSummary = error?.error?.error_summary || '';
        if (status === 409 || errSummary.includes('path/conflict')) {
            // Expected — folder exists
        } else {
            console.warn('Sync: Could not ensure app folder:', e);
        }
    }
    folderChecked = true;
}

async function downloadAppFile(relativePath: string, retryCount = 0): Promise<Blob | null> {
    if (!dbx) return null;
    const fullPath = `${APP_ROOT}${relativePath}`;
    try {
        const response = await dbx.filesDownload({ path: fullPath });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (response.result as any).fileBlob;
    } catch (e) {
        const error = e as { status?: number; response?: { status?: number; headers?: { get: (h: string) => string | null } }; error?: { error_summary?: string } };
        // Network errors (offline, DNS failure, etc.)
        if (error instanceof TypeError && retryCount < 2) {
            await new Promise(r => setTimeout(r, 3000));
            return downloadAppFile(relativePath, retryCount + 1);
        }
        const status = error?.status || error?.response?.status;
        const summary = error?.error?.error_summary || '';
        if (status === 409 || status === 404 || summary.includes('path/not_found')) {
            return null; // File doesn't exist yet
        }
        if (status === 429 && retryCount < 3) {
            const retryAfter = error?.response?.headers?.get('retry-after') || 2;
            await new Promise(r => setTimeout(r, Number(retryAfter) * 1000));
            return downloadAppFile(relativePath, retryCount + 1);
        }
        throw error;
    }
}

async function uploadAppFile(relativePath: string, content: string, retryCount = 0) {
    if (!dbx) return;
    const fullPath = `${APP_ROOT}${relativePath}`;
    try {
        await dbx.filesUpload({
            path: fullPath,
            contents: content,
            mode: { '.tag': 'overwrite' }
        });
    } catch (e) {
        const error = e as { status?: number; response?: { status?: number; headers?: { get: (h: string) => string | null } } };
        // Network errors (offline, DNS failure, etc.)
        if (error instanceof TypeError && retryCount < 2) {
            await new Promise(r => setTimeout(r, 3000));
            return uploadAppFile(relativePath, content, retryCount + 1);
        }
        const status = error?.status || error?.response?.status;
        if (status === 429 && retryCount < 3) {
            const retryAfter = error?.response?.headers?.get('retry-after') || 2;
            await new Promise(r => setTimeout(r, Number(retryAfter) * 1000));
            return uploadAppFile(relativePath, content, retryCount + 1);
        }
        throw error;
    }
}

// ---------------------------------------------------------------------------
// Auto‑Sync Debouncer
// ---------------------------------------------------------------------------

let syncTimeout: number | null = null;
let isSyncing = false;
let syncQueued = false;

async function executeSync() {
    if (!dbx) return;
    try {
        isSyncing = true;
        await syncNotesWithDrive(true);
    } catch (e) {
        console.warn('Background sync failed', e);
    } finally {
        isSyncing = false;
        if (syncQueued) {
            syncQueued = false;
            // Delay the queued sync slightly to let the system breathe
            setTimeout(executeSync, 2000);
        }
    }
}

export function triggerAutoSync() {
    if (syncTimeout) window.clearTimeout(syncTimeout);
    syncTimeout = window.setTimeout(() => {
        if (isSyncing) {
            syncQueued = true; // Don't drop it! Queue it for when the current sync finishes.
            return;
        }
        executeSync();
    }, 5000); // Back to a safer 5 seconds
}

let initSyncDone = false;

export function initSync() {
    if (initSyncDone) return; // Prevent duplicate intervals on re-render
    initSyncDone = true;
    const startedAt = Date.now();

    // 1. Poll every 5 minutes (300,000ms)
    setInterval(async () => {
        if (isDriveConnected()) {
            if (isSyncing) {
                syncQueued = true;
            } else {
                executeSync();
            }
        }
    }, 300000);

    // 2. Sync whenever the tab becomes visible again (e.g. user unlocks phone).
    // Guard: ignore visibility events within 3s of startup — some browsers fire
    // visibilitychange on initial load which would cause a duplicate startup sync.
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && isDriveConnected() && Date.now() - startedAt > 3000) {
            if (isSyncing) {
                syncQueued = true;
            } else {
                executeSync();
            }
        }
    });
}
