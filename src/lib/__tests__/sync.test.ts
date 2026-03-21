import { describe, it, expect } from 'vitest';
import { purgeTombstones, buildDiffLists, type SyncManifest } from '../sync-logic';
import type { NoteItem } from '../db';

describe('sync-logic.ts', () => {

    describe('purgeTombstones', () => {
        it('should purge tombstones older than 30 days', () => {
            const now = Date.now();
            const manifest: SyncManifest = {
                lastUpdated: now,
                items: {
                    1: { updated_at: now - 1000, isDeleted: false }, // Active, not deleted
                    2: { updated_at: now - 2000, isDeleted: true, deletedAt: now - 31 * 24 * 60 * 60 * 1000 }, // Deleted 31 days ago -> PURGE
                    3: { updated_at: now - 3000, isDeleted: true, deletedAt: now - 10 * 24 * 60 * 60 * 1000 }, // Deleted 10 days ago -> KEEP
                }
            };

            const { pruned } = purgeTombstones(manifest, now);

            expect(pruned).toBe(true);
            expect(manifest.items[1]).toBeDefined();
            expect(manifest.items[2]).toBeUndefined(); // Purged!
            expect(manifest.items[3]).toBeDefined(); // Kept
        });

        it('should fallback to updated_at if deletedAt is missing (backwards compatibility)', () => {
             const now = Date.now();
             const manifest: SyncManifest = {
                 lastUpdated: now,
                 items: {
                     1: { updated_at: now - 35 * 24 * 60 * 60 * 1000, isDeleted: true } // Old tombstone without deletedAt
                 }
             };
 
             const { pruned } = purgeTombstones(manifest, now);
             expect(pruned).toBe(true);
             expect(manifest.items[1]).toBeUndefined();
        });
    });

    describe('buildDiffLists', () => {
        // Mock dependencies
        const mockGetItemPath = (itemId: number, items: NoteItem[]) => {
            const item = items.find(i => i.id === itemId);
            return item ? item.title : '';
        };

        it('should download when remote is newer', () => {
            const lastSync = 100;
            const remoteManifest: SyncManifest = {
                lastUpdated: 200,
                items: {
                    1: { updated_at: 200, isDeleted: false }
                }
            };
            const localItems: NoteItem[] = [
                { id: 1, title: 'Note 1', updated_at: 100, type: 'note', tags: [], parentId: 0 }
            ];
            const localMap = new Map([[1, localItems[0]]]);
            
            const result = buildDiffLists(
                remoteManifest, localItems, localMap, new Set(), new Map(), lastSync, mockGetItemPath
            );

            expect(result.toDownload).toEqual([1]);
            expect(result.toUpload.length).toBe(0);
        });

        it('should upload when local is decidedly newer than remote', () => {
            const lastSync = 100;
            const remoteManifest: SyncManifest = {
                lastUpdated: 100,
                items: {
                    1: { updated_at: 100, isDeleted: false } // Cloud saw it at t=100
                }
            };
            const localItems: NoteItem[] = [
                { id: 1, title: 'Note 1', updated_at: 150, type: 'note', tags: [], parentId: 0 } // Local edited at t=150
            ];
            const localMap = new Map([[1, localItems[0]]]);

            const result = buildDiffLists(
                remoteManifest, localItems, localMap, new Set(), new Map(), lastSync, mockGetItemPath
            );

            expect(result.toDownload.length).toBe(0);
            expect(result.toUpload[0].id).toBe(1);
        });

        it('should upload over cloud if local timestamp is newer, even in a conflict', () => {
            const lastSync = 100;
            
            // Cloud updated to 150
            const remoteManifest: SyncManifest = {
                lastUpdated: 150,
                items: {
                    1: { updated_at: 150, isDeleted: false }
                }
            };
            
            // Local ALSO updated to 160
            const localItems: NoteItem[] = [
                { id: 1, title: 'Note 1', updated_at: 160, type: 'note', tags: [], parentId: 0 }
            ];
            const localMap = new Map([[1, localItems[0]]]);

            const result = buildDiffLists(
                remoteManifest, localItems, localMap, new Set(), new Map(), lastSync, mockGetItemPath
            );

            // Local is newer, so Last Write Wins applies. It will not download.
            expect(result.toDownload.length).toBe(0);
            expect(result.toUpload[0].id).toBe(1);
        });

        it('should handle path-collision ghost destruction', () => {
            const remoteManifest: SyncManifest = {
                lastUpdated: 100,
                items: {
                    1: { updated_at: 100, isDeleted: false, title: 'Ghost Note.md' }
                }
            };
            
            // Local has a DIFFERENT ID (2) but SAME PATH ('Ghost Note.md')
            const localItems: NoteItem[] = [
                { id: 2, title: 'Ghost Note.md', updated_at: 150, type: 'note', tags: [], parentId: 0 }
            ];
            const localMap = new Map([[2, localItems[0]]]);
            
            const remotePathMap = new Map([['Ghost Note.md', 1]]);

            const result = buildDiffLists(
                remoteManifest, localItems, localMap, new Set(), remotePathMap, 100, mockGetItemPath
            );

            // Id 2 should be marked for destruction!
            expect(result.ghostsToDestroy).toEqual([2]);
            // It should not be uploaded
            expect(result.toUpload.length).toBe(0);
        });
    });
});
