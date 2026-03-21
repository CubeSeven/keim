import type { NoteItem } from './db';

export interface SyncManifestItem {
    updated_at: number;
    isDeleted: boolean;
    deletedAt?: number;  // When the item was deleted — used for 30-day tombstone purge
    title?: string;      // Added for path-based dedup on fresh devices
    parentPath?: string; // Added for path-based dedup on fresh devices
}

export interface SyncManifest {
    lastUpdated: number;
    items: {
        [id: number]: SyncManifestItem;
    }
}

// How long to retain tombstones before purging (30 days in ms)
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function purgeTombstones(manifest: SyncManifest, now: number = Date.now()): { pruned: boolean } {
    let pruned = false;
    for (const [idStr, meta] of Object.entries(manifest.items)) {
        if (meta.isDeleted) {
            const deletedAt = meta.deletedAt ?? meta.updated_at; // fallback for old tombstones
            if (now - deletedAt > TOMBSTONE_TTL_MS) {
                delete manifest.items[Number(idStr)];
                pruned = true;
                console.log(`Sync: purged stale tombstone for id ${idStr} (deleted ${Math.floor((now - deletedAt) / 86_400_000)} days ago).`);
            }
        }
    }
    return { pruned };
}

export function buildRemotePathMap(manifest: SyncManifest): Map<string, number> {
    const remotePathMap = new Map<string, number>();
    for (const [idStr, meta] of Object.entries(manifest.items)) {
        if (meta.title && !meta.isDeleted) {
            const fp = meta.parentPath ? `${meta.parentPath}/${meta.title}` : meta.title;
            remotePathMap.set(fp, Number(idStr));
        }
    }
    return remotePathMap;
}

export function buildDiffLists(
    remoteManifest: SyncManifest,
    localItems: NoteItem[],
    localMap: Map<number, NoteItem>,
    dedupedIds: Set<number>,
    remotePathMap: Map<string, number>,
    lastSyncTime: number | null,
    getItemPath: (itemId: number, localItems: NoteItem[]) => string
): { toDownload: number[], toUpload: NoteItem[], ghostsToDestroy: number[] } {
    const toDownload: number[] = [];
    const toUpload: NoteItem[] = [];
    const ghostsToDestroy: number[] = [];

    // Diff: remote → local
    for (const [idStr, remoteMeta] of Object.entries(remoteManifest.items)) {
        const id = Number(idStr);
        if (isNaN(id)) continue;
        const localItem = localMap.get(id);

        if (!localItem || (localItem.updated_at !== undefined && remoteMeta.updated_at > localItem.updated_at)) {
            if (localItem && lastSyncTime && localItem.updated_at > lastSyncTime && !remoteMeta.isDeleted) {
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
            if (!remoteMeta && !localItem.isDeleted) {
                const parentPath = localItem.parentId ? getItemPath(localItem.parentId, localItems) : '';
                const fullPath = parentPath ? `${parentPath}/${localItem.title}` : localItem.title;
                if (remotePathMap.has(fullPath)) {
                    console.warn(`Sync: Destroying path collision ghost "${fullPath}" (Local ID: ${localItem.id}). Cloud version strictly wins.`);
                    ghostsToDestroy.push(localItem.id);
                    continue; // Prevent it from being uploaded
                }
            }

            if (!toUpload.find(item => item.id === localItem.id)) {
                toUpload.push(localItem);
            }
        }
    }

    return { toDownload, toUpload, ghostsToDestroy };
}
