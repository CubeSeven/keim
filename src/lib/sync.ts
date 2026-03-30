import { db, addItem, type NoteItem, getItemPath } from './db';
import { getCloudProvider } from './cloud/ProviderManager';
import { DropboxProvider } from './cloud/DropboxProvider';
import { writeNoteToVault, deleteFromVault, getStorageMode, notePathFromTitle } from './vault';
import { useAppStore } from '../store';
import { encryptTextToBuffer, decryptTextFromBuffer } from './crypto';
import { revokeBiometric } from './biometrics';
import { KEYS } from '../lib/constants';
import { purgeTombstones, buildRemotePathMap, buildDiffLists, type SyncManifest, type SyncManifestItem } from './sync-logic';

// Only log verbose sync details in development builds
const DEBUG = import.meta.env.DEV;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let lastSyncTime: number | null = Number(localStorage.getItem(KEYS.LAST_SYNC)) || null;

// When vault is locked (permission revoked on Android), we must NOT sync —
// the local Dexie cache may be stale and uploading it would overwrite newer
// cloud / disk data. isVaultLocked is managed via useAppStore and synced here.
// eslint-disable-next-line prefer-const
let _vaultIsLocked = false;

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
    resetLocalSyncState();
    lastAuthCheck = 0;
    
    // Security: Purge encryption keys from memory and disk on disconnect
    localStorage.removeItem('keim_active_dek');
    revokeBiometric();
    useAppStore.getState().setActiveDEK(null);
    useAppStore.getState().setIsBiometricEnrolled(false);
}

export function resetLocalSyncState() {
    lastSyncTime = null;
    localStorage.removeItem(KEYS.LAST_SYNC);
}

// ---------------------------------------------------------------------------
// E2EE Transport Helpers
// ---------------------------------------------------------------------------

async function secureUpload(path: string, contentStr: string, dek: CryptoKey | null) {
    if (dek) {
        const { ciphertext, iv } = await encryptTextToBuffer(contentStr, dek);
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(ciphertext), iv.length);
        const baseName = path.endsWith('.json') ? path.slice(0, -5) : path;
        if (DEBUG) console.log(`🔒 [E2EE] Encrypting and uploading ${baseName}.enc instead of ${path}`);
        await getCloudProvider().uploadFile(`${baseName}.enc`, new Blob([combined]));
    } else {
        if (DEBUG) console.log(`🌐 [Plaintext] Uploading unencrypted ${path}`);
        await getCloudProvider().uploadFile(path, contentStr);
    }
}

async function secureDownload(path: string, dek: CryptoKey | null): Promise<string | null> {
    const baseName = path.endsWith('.json') ? path.slice(0, -5) : path;
    
    // If encrypted vault, try .enc first
    if (dek) {
        const encBlob = await getCloudProvider().downloadFile(`${baseName}.enc`);
        if (encBlob) {
             console.log(`🔓 [E2EE] Downloaded ${baseName}.enc - Decrypting payload to memory...`);
             const buffer = await encBlob.arrayBuffer();
             if (buffer.byteLength > 12) {
                 const iv = new Uint8Array(buffer, 0, 12);
                 const ciphertext = buffer.slice(12);
                 try {
                     return await decryptTextFromBuffer(ciphertext, iv, dek);
                 } catch (e) {
                     console.error('Decryption failed for', path, e);
                 }
             }
        }
    }
    
    // Fallback to .json
    const blob = await getCloudProvider().downloadFile(path);
    if (blob) {
         console.log(`🌐 [Plaintext] Downloaded unencrypted ${path}`);
         return await blob.text();
    }
    return null;
}

// ---------------------------------------------------------------------------
// V2 Granular Sync
// ---------------------------------------------------------------------------

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
                if (!lock) { if (DEBUG) console.log('Sync skipped: another tab is syncing.'); return; }
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
        if (DEBUG) console.log('Starting Dropbox Sync...');
        broadcastSyncStatus('syncing');

        // Ensure the keim folder exists (silent on conflict)
        await getCloudProvider().ensureAppFolder();
        
        const provider = getCloudProvider();
        if (typeof provider.checkVaultState === 'function') {
            const vaultState = await provider.checkVaultState();
            const { activeDEK, isE2EESkipped, setE2eeModalState } = useAppStore.getState();

            // If empty and not skipped, prompt for setup
            if (vaultState === 'EMPTY' && !isE2EESkipped && !activeDEK) {
                    if (DEBUG) console.log('Sync paused: Fresh vault, asking for E2EE setup.');
                 setE2eeModalState({ isOpen: true, mode: 'setup' });
                 broadcastSyncStatus('idle');
                 return;
            }

            // If locked and no DEK, prompt for password
            if (vaultState === 'LOCKED' && !activeDEK) {
                 if (DEBUG) console.log('Sync paused: Vault is E2EE locked. Asking for password.');
                 setE2eeModalState({ isOpen: true, mode: 'unlock' });
                 broadcastSyncStatus('idle');
                 return;
            }
        }

        const dek = useAppStore.getState().activeDEK;

        // --- MANIFEST DOWNLOAD + INTEGRITY CHECK ---
        // Validate the manifest structure before trusting it. If it's
        // corrupt (partial write, truncation, etc.), start fresh so we
        // don't make wrong sync decisions based on garbage timestamps.
        let remoteManifest: SyncManifest = { lastUpdated: 0, items: {} };
        const manifestText = await secureDownload('/manifest.json', dek);
        if (manifestText) {
            try {
                const parsed = JSON.parse(manifestText);
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
        // Remove tombstones older than 30 days.
        const { pruned: manifestPruned } = purgeTombstones(remoteManifest);

        let localItems = await db.items.toArray();
        const localMap = new Map<number, NoteItem>();
        localItems.forEach(item => { if (item.id !== undefined) localMap.set(item.id, item); });

        // -----------------------------------------------------------------
        // FIRST-SYNC DEDUP & RECONCILIATION
        // -----------------------------------------------------------------
        const dedupedIds = new Set<number>();
        const collisionsToReassign: NoteItem[] = [];

        // ALWAYS build a path→remoteId map from manifest metadata for all syncs.
        const remotePathMap = buildRemotePathMap(remoteManifest);

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

                        if (storageMode === 'vault') {
                            try {
                                const parentPath = getItemPath(localItem.parentId, localItems);
                                const path = localItem.type === 'note' ? notePathFromTitle(localItem.title, parentPath) : (parentPath ? `${parentPath}/${localItem.title}` : localItem.title);
                                await deleteFromVault(path);
                            } catch (e) {
                                console.error('Failed to delete overwritten item from vault', e);
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
            for (const localItem of localItems) {
                if (localItem.id === undefined || localItem.isDeleted || dedupedIds.has(localItem.id)) continue;

                const remoteMeta = remoteManifest.items[localItem.id];
                if (remoteMeta) {
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
            const localOnlyItems = localItems.filter(li => {
                if (li.id === undefined || li.isDeleted || dedupedIds.has(li.id)) return false;
                const parentPath = getItemPath(li.parentId, localItems);
                const fullPath = parentPath ? `${parentPath}/${li.title}` : li.title;
                return !remotePathMap.has(fullPath);
            });

            if (localOnlyItems.length > 0) {
                for (const item of localOnlyItems) {
                    console.log(`Sync: Silently discarding orphan local file "${item.title}"`);

                    if (storageMode === 'vault') {
                        try {
                            const parentPath = getItemPath(item.parentId, localItems);
                            const path = item.type === 'note' ? notePathFromTitle(item.title, parentPath) : (parentPath ? `${parentPath}/${item.title}` : item.title);
                            await deleteFromVault(path);
                        } catch (e) {
                            console.error('Failed to delete orphan item from vault', e);
                        }
                    }

                    await db.items.delete(item.id!);
                    await db.contents.delete(item.id!);
                    await db.smartSchemas.where({ folderId: item.id! }).delete();
                    dedupedIds.add(item.id!);
                }
                localItems = await db.items.toArray();
            }

            localMap.clear();
            localItems.forEach(item => { if (item.id !== undefined) localMap.set(item.id, item); });
        }

        const { toDownload, toUpload, ghostsToDestroy } = buildDiffLists(
            remoteManifest,
            localItems,
            localMap,
            dedupedIds,
            remotePathMap,
            lastSyncTime,
            getItemPath
        );

        // Process path collision ghosts returned by buildDiffLists (Strict Cloud Wins)
        if (ghostsToDestroy.length > 0) {
            for (const ghostId of ghostsToDestroy) {
                await db.items.delete(ghostId);
                await db.contents.delete(ghostId);
                await db.smartSchemas.where({ folderId: ghostId }).delete();
                dedupedIds.add(ghostId);
            }
        }

        if (DEBUG) console.log(`Sync: ${toDownload.length} to download, ${toUpload.length} to upload.`);

        // Downloads - Parallelised with concurrency limit to prevent half-synced
        // state on partial failure while still being fast on mobile.
        // Concurrency set to 3 to strictly respect Dropbox rate limits.
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
                            const path = existingLocal.type === 'note' ? notePathFromTitle(existingLocal.title, parentPath) : (parentPath ? `${parentPath}/${existingLocal.title}` : existingLocal.title);
                            await deleteFromVault(path);
                        } catch { /* best‑effort */ }
                    }
                } else if (!isRemoteDeleted) {
                    const itemText = await secureDownload(`/items/${id}.json`, dek);
                    if (itemText) {
                        const item = JSON.parse(itemText);

                        // --- VALIDATION: never overwrite with corrupt data ---
                        if (!item || typeof item.id !== 'number' || !item.title || !item.type) {
                            console.error(`Sync: skipping corrupt download for id ${id}`, item);
                            return;
                        }

                        await db.items.put(item);
                        if (item.type === 'note' && !item.isDeleted) {
                            // Download item + content in parallel
                            const contentText = await secureDownload(`/contents/${id}.json`, dek);
                            if (contentText) {
                                const contentData = JSON.parse(contentText);

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
        await runParallel(downloadTasks, 3);

        // Uploads - Parallelised with concurrency limit.
        // Each note has up to 2 files (item + content), so concurrency 2 means
        // up to 4 parallel API calls. This safely stays under Dropbox's 429 thresholds.
        const uploadTasks = toUpload.map(item => async () => {
            await secureUpload(`/items/${item.id}.json`, JSON.stringify(item), dek);
            if (item.type === 'note' && !item.isDeleted) {
                const content = await db.contents.get(item.id!);
                if (content) {
                    await secureUpload(`/contents/${item.id}.json`, JSON.stringify(content), dek);
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
        await runParallel(uploadTasks, 2);

        if (toUpload.length > 0 || toDownload.length > 0 || manifestPruned) {
            remoteManifest.lastUpdated = Date.now();
            await secureUpload('/manifest.json', JSON.stringify(remoteManifest), dek);
        }

        // --- SMART SCHEMAS SYNC ---
        const schemasText = await secureDownload('/schemas.json', dek);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let remoteSchemas: Record<number, any[]> = {};
        if (schemasText) {
            try { remoteSchemas = JSON.parse(schemasText); } catch { /* ignore */ }
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
             await secureUpload('/schemas.json', JSON.stringify(remoteSchemas), dek);
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
        localStorage.setItem(KEYS.LAST_SYNC, lastSyncTime.toString());
        if (DEBUG) console.log('Dropbox Sync complete!');
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
