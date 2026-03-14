import { db, addItem, type NoteItem, getItemPath } from './db';
import { getCloudProvider } from './cloud/ProviderManager';
import { DropboxProvider } from './cloud/DropboxProvider';
import { writeNoteToVault, deleteFromVault, getStorageMode, notePathFromTitle } from './vault';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let lastSyncTime: number | null = Number(localStorage.getItem('keim_last_sync')) || null;

// When vault is locked (permission revoked on Android), we must NOT sync —
// the local Dexie cache may be stale and uploading it would overwrite newer
// cloud / disk data. Set this to true while isVaultLocked === true in App.tsx.
let _vaultIsLocked = false;
export function setVaultLocked(locked: boolean) { _vaultIsLocked = locked; }

// Cross-tab synchronization
const syncChannel = new BroadcastChannel('keim_sync');

function broadcastSyncStatus(status: 'syncing' | 'synced' | 'error' | 'idle' | 'disconnected') {
    window.dispatchEvent(new CustomEvent('keim_sync_status', { detail: status }));
    // Also notify other tabs
    if (status === 'synced' || status === 'error') {
        syncChannel.postMessage({ type: 'sync_status', status });
    }
}

export function isDriveConnected() { return getCloudProvider().isConnected(); }
export function getLastSyncTime() { return lastSyncTime; }

/**
 * Run an array of async tasks with a maximum concurrency.
 * This is the key perf primitive: lets us send 6 requests in parallel
 * instead of one-by-one, while still respecting Dropbox rate limits.
 */
async function runParallel<T>(
    tasks: (() => Promise<T>)[],
    concurrency = 6
): Promise<T[]> {
    const results: T[] = [];
    let index = 0;
    async function worker(): Promise<void> {
        while (index < tasks.length) {
            const i = index++;
            results[i] = await tasks[i]();
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
    await Promise.all(workers);
    return results;
}

// ---------------------------------------------------------------------------
// Auth helpers (Delegated)
// ---------------------------------------------------------------------------

export async function authorizeDropbox(): Promise<boolean> {
    return getCloudProvider().authorize();
}

export async function loginToDropbox() {
    return getCloudProvider().login();
}

export function disconnectDropbox() {
    getCloudProvider().disconnect();
    // Reset our local sync engine state
    lastSyncTime = null;
    lastAuthCheck = 0;
    localStorage.removeItem('keim_last_sync');
}

// ---------------------------------------------------------------------------
// V2 Granular Sync
// ---------------------------------------------------------------------------

interface SyncManifestItem {
    updated_at: number;
    isDeleted: boolean;
    deletedAt?: number;  // When the item was deleted — used for 30-day tombstone purge
    title?: string;      // Added for path-based dedup on fresh devices
    parentPath?: string; // Added for path-based dedup on fresh devices
}

interface SyncManifest {
    lastUpdated: number;
    items: {
        [id: number]: SyncManifestItem;
    }
}

// How long to retain tombstones before purging (30 days in ms)
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Cache auth verification — no need to call usersGetCurrentAccount every sync
let lastAuthCheck = 0;
const AUTH_CHECK_TTL = 600000; // 10 minutes

export async function syncNotesWithDrive(background = false) {
    // Never sync with stale data when the vault has not yet been unlocked.
    if (_vaultIsLocked) {
        console.log('Sync skipped: vault is locked.');
        return;
    }

    // --- SYNC LEADER LOCK ---
    // Use the Web Locks API to guarantee only one tab/instance runs the sync
    // at a time. Without this, two open tabs can race to update manifest.json,
    // with the last writer silently overwriting the first's changes.
    // - Background syncs: yield immediately if another tab already holds the lock.
    //   The winning tab's BroadcastChannel message propagates results to all tabs.
    // - Manual (user-triggered) syncs: wait in queue so user always gets a full sync.
    // Falls back gracefully on browsers without Locks API support.
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
        if (background) {
            return navigator.locks.request('keim_sync_leader', { ifAvailable: true }, async (lock) => {
                if (!lock) { console.log('Sync skipped: another tab is syncing.'); return; }
                return _runSync(background);
            });
        }
        return navigator.locks.request('keim_sync_leader', async () => _runSync(background));
    }
    return _runSync(background);
}

async function _runSync(background = false) {

    const isAuthorized = await authorizeDropbox();
    if (!isAuthorized) {
        if (background) return;
        await loginToDropbox();
        return;
    }
    if (!getCloudProvider().isConnected()) return;

    if (!navigator.onLine) {
        throw new Error('You are offline. Please check your connection.');
    }

    // Only verify the token if it hasn't been checked recently
    if (Date.now() - lastAuthCheck > AUTH_CHECK_TTL) {
        const provider = getCloudProvider();
        if (provider instanceof DropboxProvider) {
            const healthy = await provider.checkAuthHealth();
            if (!healthy) {
                broadcastSyncStatus('disconnected');
                throw new Error('Cloud session expired. Please connect again.');
            }
        }
        lastAuthCheck = Date.now();
    }

    const storageMode = getStorageMode();

    try {
        console.log('Starting Dropbox Sync...');
        broadcastSyncStatus('syncing');

        // Ensure the keim folder exists (silent on conflict)
        await getCloudProvider().ensureAppFolder();

        // --- MANIFEST DOWNLOAD + INTEGRITY CHECK ---
        // Validate the manifest structure before trusting it. If it's
        // corrupt (partial write, truncation, etc.), start fresh so we
        // don't make wrong sync decisions based on garbage timestamps.
        let remoteManifest: SyncManifest = { lastUpdated: 0, items: {} };
        const manifestBlob = await getCloudProvider().downloadFile('/manifest.json');
        if (manifestBlob) {
            try {
                const parsed = JSON.parse(await manifestBlob.text());
                // Integrity gate: must have a numeric lastUpdated and an items object
                if (
                    parsed &&
                    typeof parsed.lastUpdated === 'number' &&
                    typeof parsed.items === 'object' &&
                    parsed.items !== null &&
                    // Sanity-check: lastUpdated must not be in the far future (>1 day ahead)
                    parsed.lastUpdated <= Date.now() + 86_400_000
                ) {
                    remoteManifest = parsed;
                } else {
                    console.warn('Sync: manifest failed integrity check — starting with full re-scan.', parsed);
                }
            } catch {
                console.warn('Sync: manifest JSON corrupt — starting with full re-scan.');
            }
        }

        // --- TOMBSTONE PURGE ---
        // Remove tombstones older than 30 days. By now every online device
        // will have seen the deletion (it was uploaded 30+ days ago).
        // This prevents manifest.json from growing indefinitely.
        const now = Date.now();
        let manifestPruned = false;
        for (const [idStr, meta] of Object.entries(remoteManifest.items)) {
            if (meta.isDeleted) {
                const deletedAt = meta.deletedAt ?? meta.updated_at; // fallback for old tombstones
                if (now - deletedAt > TOMBSTONE_TTL_MS) {
                    delete remoteManifest.items[Number(idStr)];
                    manifestPruned = true;
                    console.log(`Sync: purged stale tombstone for id ${idStr} (deleted ${Math.floor((now - deletedAt) / 86_400_000)} days ago).`);
                }
            }
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

        // ALWAYS build a path→remoteId map from manifest metadata for all syncs.
        // This stops resurrected ghost files (which get new local IDs) from
        // overwriting cloud files simply because their OS timestamp appears newer.
        const remotePathMap = new Map<string, number>();
        for (const [idStr, meta] of Object.entries(remoteManifest.items)) {
            if (meta.title && !meta.isDeleted) {
                const fp = meta.parentPath ? `${meta.parentPath}/${meta.title}` : meta.title;
                remotePathMap.set(fp, Number(idStr));
            }
        }

        if (!lastSyncTime) {
            if (remotePathMap.size > 0) {
                // Check if we should warn the user: are there many local files that match cloud paths
                // but have suspicious timestamps (e.g., all recently modified)?
                const pathMatches = localItems.filter(li => {
                    const parentPath = getItemPath(li.parentId, localItems);
                    const fullPath = parentPath ? `${parentPath}/${li.title}` : li.title;
                    return remotePathMap.has(fullPath);
                });

                if (pathMatches.length > 0) {
                    for (const localItem of pathMatches) {
                        if (localItem.id === undefined) continue;
                        console.log(`Dedup: Automatically overwriting local "${localItem.title}" with cloud version.`);

                        if (storageMode === 'vault' && localItem.type === 'note') {
                            try {
                                const parentPath = getItemPath(localItem.parentId, localItems);
                                const path = notePathFromTitle(localItem.title, parentPath);
                                await deleteFromVault(path);
                            } catch (e) {
                                console.error('Failed to delete overwritten note from vault', e);
                            }
                        }

                        await db.items.delete(localItem.id);
                        await db.contents.delete(localItem.id);
                        localMap.delete(localItem.id);
                        dedupedIds.add(localItem.id);
                    }
                    // Refresh local items
                    localItems = await db.items.toArray();
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
                    const parentPath = getItemPath(localItem.parentId, localItems);
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

                    const schema = await db.smartSchemas.where({ folderId: oldId }).first();
                    if (schema && schema.id) {
                         await db.smartSchemas.update(schema.id, { folderId: newId });
                    }

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
                const parentPath = getItemPath(li.parentId, localItems);
                const fullPath = parentPath ? `${parentPath}/${li.title}` : li.title;
                return !remotePathMap.has(fullPath);
            });

            if (localOnlyItems.length > 0) {
                // Silently discard local orphans on first sync. 
                // We no longer ask since the cloud is the absolute truth.
                for (const item of localOnlyItems) {
                    console.log(`Sync: Silently discarding orphan local file "${item.title}"`);

                    if (storageMode === 'vault' && item.type === 'note') {
                        try {
                            const parentPath = getItemPath(item.parentId, localItems);
                            const path = notePathFromTitle(item.title, parentPath);
                            await deleteFromVault(path);
                        } catch (e) {
                            console.error('Failed to delete orphan note from vault', e);
                        }
                    }

                    await db.items.delete(item.id!);
                    await db.contents.delete(item.id!);
                    await db.smartSchemas.where({ folderId: item.id! }).delete();
                    dedupedIds.add(item.id!);
                }
                // Final refresh
                localItems = await db.items.toArray();
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

                // --- UPDATE vs UPDATE CONFLICT ---
                // If local file was ALSO updated since the last sync, we have a conflict!
                if (localItem && lastSyncTime && localItem.updated_at > lastSyncTime && !remoteMeta.isDeleted) {
                    // Strict Cloud Truth: we DO NOT create a "Local Conflict" file.
                    // We let the cloud version seamlessly overwrite the local edits.
                    console.warn(`Conflict detected for note "${localItem.title}". Cloud version strictly wins.`);
                }

                if (!remoteMeta.isDeleted || localItem) toDownload.push(id);
            }
        }

        // Diff: local → remote
        for (const localItem of localItems) {
            if (localItem.id === undefined) continue;
            if (dedupedIds.has(localItem.id)) continue; // Already removed as a vault duplicate
            const remoteMeta = remoteManifest.items[localItem.id];

            // 1. Existing file check (has remoteMeta) OR local is decidedly newer
            if (!remoteMeta || localItem.updated_at > remoteMeta.updated_at) {
                // Skip re-uploading a tombstone that is already recorded as deleted in the remote.
                if (localItem.isDeleted && remoteMeta?.isDeleted) continue;

                // 2. GHOST DESTRUCTION / STRICT CLOUD WINS
                // If this is a seemingly "new" local item (no remote collision by ID),
                // we MUST check if it collides by PATH. If our local file system resurrected
                // an old file (e.g. Android scoped storage deletion bug), it will hit this block
                // with a new ID and a fresh OS timestamp. We kill it here.
                if (!remoteMeta && !localItem.isDeleted) {
                    const parentPath = getItemPath(localItem.parentId, localItems);
                    const fullPath = parentPath ? `${parentPath}/${localItem.title}` : localItem.title;
                    if (remotePathMap.has(fullPath)) {
                        console.warn(`Sync: Destroying path collision ghost "${fullPath}" (Local ID: ${localItem.id}). Cloud version strictly wins.`);
                        // Only delete from DB here. the toDownload pass below will pull the remote version 
                        // and correctly overwrite the physical file with the cloud content.
                        await db.items.delete(localItem.id);
                        await db.contents.delete(localItem.id);
                        await db.smartSchemas.where({ folderId: localItem.id }).delete();
                        dedupedIds.add(localItem.id);
                        // Prevent it from being uploaded
                        continue;
                    }
                }

                // Prevent duplicate uploads if we just added it to toUpload during the conflict resolution
                if (!toUpload.find(item => item.id === localItem.id)) {
                    toUpload.push(localItem);
                }
            }
        }

        console.log(`Sync: ${toDownload.length} to download, ${toUpload.length} to upload.`);

        // Downloads - Parallelised with concurrency limit to prevent half-synced
        // state on partial failure while still being fast on mobile.
        const downloadTasks = toDownload.map(id => async () => {
            try {
                const isRemoteDeleted = remoteManifest.items[id]?.isDeleted;
                const existingLocal = localMap.get(id);

                if (isRemoteDeleted && existingLocal) {
                    await db.items.update(id, { isDeleted: true, updated_at: Date.now() });
                    // Clean up content for confirmed remote deletions
                    await db.contents.delete(id);
                    await db.smartSchemas.where({ folderId: id }).delete();
                    if (storageMode === 'vault') {
                        try {
                            const parentPath = getItemPath(existingLocal.parentId, localItems);
                            const path = notePathFromTitle(existingLocal.title, parentPath);
                            await deleteFromVault(path);
                        } catch { /* best‑effort */ }
                    }
                } else if (!isRemoteDeleted) {
                    const itemBlob = await getCloudProvider().downloadFile(`/items/${id}.json`);
                    if (itemBlob) {
                        const item = JSON.parse(await itemBlob.text());

                        // --- VALIDATION: never overwrite with corrupt data ---
                        if (!item || typeof item.id !== 'number' || !item.title || !item.type) {
                            console.error(`Sync: skipping corrupt download for id ${id}`, item);
                            return;
                        }

                        await db.items.put(item);
                        if (item.type === 'note' && !item.isDeleted) {
                            // Download item + content in parallel
                            const contentBlob = await getCloudProvider().downloadFile(`/contents/${id}.json`);
                            if (contentBlob) {
                                const contentData = JSON.parse(await contentBlob.text());

                                // Validate content data
                                if (!contentData || typeof contentData.id !== 'number') {
                                    console.error(`Sync: skipping corrupt content for id ${id}`);
                                    return;
                                }

                                await db.contents.put(contentData);
                                if (storageMode === 'vault') {
                                    try {
                                        const parentPath = getItemPath(item.parentId, await db.items.toArray());
                                        const path = notePathFromTitle(item.title, parentPath);

                                        if (existingLocal && existingLocal.type === 'note') {
                                            const oldParentPath = getItemPath(existingLocal.parentId, localItems);
                                            const oldPath = notePathFromTitle(existingLocal.title, oldParentPath);
                                            if (oldPath !== path) {
                                                await deleteFromVault(oldPath).catch(console.warn);
                                            }
                                        }

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
        });
        await runParallel(downloadTasks);

        // Uploads - Parallelised with concurrency limit.
        // Each note has 2 files (item + content), so we batch them as one task.
        const uploadTasks = toUpload.map(item => async () => {
            await getCloudProvider().uploadFile(`/items/${item.id}.json`, JSON.stringify(item));
            if (item.type === 'note' && !item.isDeleted) {
                const content = await db.contents.get(item.id!);
                if (content) {
                    await getCloudProvider().uploadFile(`/contents/${item.id}.json`, JSON.stringify(content));
                }
            }
            const manifestEntry: SyncManifestItem = {
                updated_at: item.updated_at,
                isDeleted: !!item.isDeleted,
                title: item.title,
                parentPath: getItemPath(item.parentId, localItems),
            };
            if (item.isDeleted) {
                // Record WHEN the item was deleted for the 30-day tombstone TTL.
                // Use existing deletedAt if already set (idempotent across syncs).
                manifestEntry.deletedAt = remoteManifest.items[item.id!]?.deletedAt ?? item.updated_at;
                // --- HARD-DELETE orphaned content from IndexedDB ---
                // At this point the tombstone is confirmed uploaded to Dropbox,
                // so it's safe to free the content from local storage.
                await db.contents.delete(item.id!);
            }
            remoteManifest.items[item.id!] = manifestEntry;
        });
        await runParallel(uploadTasks);

        if (toUpload.length > 0 || toDownload.length > 0 || manifestPruned) {
            remoteManifest.lastUpdated = Date.now();
            await getCloudProvider().uploadFile('/manifest.json', JSON.stringify(remoteManifest));
        }

        // --- SMART SCHEMAS SYNC ---
        const schemasBlob = await getCloudProvider().downloadFile('/schemas.json');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let remoteSchemas: Record<number, any[]> = {};
        if (schemasBlob) {
            try { remoteSchemas = JSON.parse(await schemasBlob.text()); } catch { /* ignore */ }
        }
        
        let schemasModified = false;

        // Apply downloads: for every folder we downloaded, overwrite local schema
        // If there's no schema on remote, remove local schema (cloud wins).
        for (const downloadedId of toDownload) {
             const rSchema = remoteSchemas[downloadedId];
             if (rSchema) {
                 const existing = await db.smartSchemas.where({ folderId: downloadedId }).first();
                 if (existing && existing.id) {
                      await db.smartSchemas.update(existing.id, { fields: rSchema });
                 } else {
                      await db.smartSchemas.add({ folderId: downloadedId, fields: rSchema });
                 }
             } else {
                 await db.smartSchemas.where({ folderId: downloadedId }).delete();
             }
        }

        // Apply uploads: any folder that was in toUpload overrides remoteSchemas
        for (const upItem of toUpload) {
             if (upItem.type === 'folder' && !upItem.isDeleted) {
                  const localS = await db.smartSchemas.where({ folderId: upItem.id! }).first();
                  if (localS && localS.fields.length > 0) {
                      remoteSchemas[upItem.id!] = localS.fields;
                      schemasModified = true;
                  } else if (remoteSchemas[upItem.id!]) {
                      delete remoteSchemas[upItem.id!];
                      schemasModified = true;
                  }
             } else if (upItem.isDeleted) {
                  if (remoteSchemas[upItem.id!]) {
                      delete remoteSchemas[upItem.id!];
                      schemasModified = true;
                  }
             }
        }
        
        // Also cleanup remoteSchemas keys that might have been globally deleted
        // i.e., keys that exist in remoteSchemas but the folder is deleted in remoteManifest
        for (const idStr of Object.keys(remoteSchemas)) {
             const fId = Number(idStr);
             if (remoteManifest.items[fId]?.isDeleted) {
                 delete remoteSchemas[fId];
                 schemasModified = true;
             }
        }

        if (schemasModified || !lastSyncTime) { 
             await getCloudProvider().uploadFile('/schemas.json', JSON.stringify(remoteSchemas));
        }

        // --- PHYSICAL VAULT RECONCILIATION ---
        // Guarantee that the disk matches the sidebar after sync updates.
        // Optimization: if we have specific downloads/uploads, perform incremental reconciliation.
        if (storageMode === 'vault') {
            try {
                const { reconcileVault } = await import('./vault');
                const { getItemPath } = await import('./db');
                // MUST fetch fresh state here, since `localItems` was fetched before the sync changes!
                const freshAllItems = await db.items.toArray();
                const freshAllContents = await db.contents.toArray();
                
                // If it's a small update, only reconcile the affected items
                const affectedIds = (toDownload.length + toUpload.length < 50) 
                    ? [...toDownload, ...toUpload.map(i => i.id!)]
                    : undefined;

                await reconcileVault(freshAllItems, freshAllContents, getItemPath, affectedIds);
            } catch (e) {
                console.error('Failed to reconcile vault after sync', e);
            }
        }

        lastSyncTime = Date.now();
        localStorage.setItem('keim_last_sync', lastSyncTime.toString());
        console.log('Dropbox Sync complete!');
        broadcastSyncStatus('synced');
        
        // Notify other tabs to refresh their UI
        syncChannel.postMessage({ 
            type: 'sync_complete', 
            downloadedIds: toDownload,
            timestamp: lastSyncTime
        });

        // Tell the local UI that content may have changed
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
// Auto-Sync Debouncer
// ---------------------------------------------------------------------------

let syncTimeout: number | null = null;
let isSyncing = false;
let syncQueued = false;

async function executeSync() {
    if (!getCloudProvider().isConnected()) return;
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
    }, 2000); // 2s debounce — fast enough to feel real-time, safe enough to batch rapid edits
}

let initSyncDone = false;

export function initSync() {
    if (initSyncDone) return; // Prevent duplicate intervals on re-render
    initSyncDone = true;
    const startedAt = Date.now();

    // 1. Poll every 5 minutes (300,000ms)
    setInterval(async () => {
        if (isDriveConnected() && !_vaultIsLocked) {
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
        if (document.visibilityState === 'visible' && isDriveConnected() && !_vaultIsLocked && Date.now() - startedAt > 3000) {
            if (isSyncing) {
                syncQueued = true;
            } else {
                executeSync();
            }
        }
    });
}
