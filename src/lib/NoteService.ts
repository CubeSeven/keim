import { db, addItem, updateItem, deleteItem, getItemPath, type NoteItem } from './db';
import { getStorageMode, writeNoteToVault, deleteFromVault, notePathFromTitle, moveVaultFolder, createFolderInVault } from './vault';
import { updateSearchIndex, removeFromSearchIndex } from './search';
import { triggerAutoSync } from './sync';

export const NoteService = {
    /**
     * Creates a new note, writes it to Vault (if enabled), and queues sync.
     * @returns The newly created item ID
     */
    async createNote(parentId: number, title: string, initialContent: string = ''): Promise<number> {
        const id = await addItem({ parentId, type: 'note', title }, initialContent);
        localStorage.setItem('keim_has_user_edits', 'true');

        if (getStorageMode() === 'vault') {
            try {
                const allItems = await db.items.toArray();
                const parentPath = getItemPath(parentId, allItems);
                const path = notePathFromTitle(title, parentPath);
                await writeNoteToVault(path, initialContent);
            } catch (e) {
                console.warn('Could not write new note to vault immediately', e);
            }
        }

        triggerAutoSync();
        return id as number;
    },

    /**
     * Creates a new folder, creates it in Vault (if enabled), and queues sync.
     * @returns The newly created item ID
     */
    async createFolder(parentId: number, title: string): Promise<number> {
        const id = await addItem({ parentId, type: 'folder', title }, '');
        localStorage.setItem('keim_has_user_edits', 'true');

        if (getStorageMode() === 'vault') {
            try {
                const allItems = await db.items.toArray();
                const parentPath = getItemPath(parentId, allItems);
                const folderPath = parentPath ? `${parentPath}/${title}` : title;
                await createFolderInVault(folderPath);
            } catch (e) {
                console.warn('Could not create folder in vault immediately', e);
            }
        }

        triggerAutoSync();
        return id as number;
    },

    /**
     * Renames an item (note or folder), cleanly updating the Vault paths and syncing.
     */
    async renameItem(item: NoteItem, newTitle: string): Promise<void> {
        if (!item.id || newTitle === item.title) return;

        const allItems = await db.items.toArray();
        const parentPath = getItemPath(item.parentId, allItems);

        // 1. UPDATE DB FIRST
        await updateItem(item.id, { title: newTitle });

        // 2. Update physical vault
        if (getStorageMode() === 'vault') {
            try {
                if (item.type === 'note') {
                    const oldPath = notePathFromTitle(item.title, parentPath);
                    const newPath = notePathFromTitle(newTitle, parentPath);
                    let textContent = '';
                    const contentObj = await db.contents.get(item.id);
                    if (contentObj) textContent = contentObj.content;

                    await deleteFromVault(oldPath);
                    await writeNoteToVault(newPath, textContent);
                } else if (item.type === 'folder') {
                    const oldFolderPath = getItemPath(item.id, allItems); // Uses old title from snapshot
                    const newFolderPath = parentPath ? `${parentPath}/${newTitle}` : newTitle;
                    
                    const allContents = await db.contents.toArray();
                    const freshItems = await db.items.toArray(); 
                    await moveVaultFolder(oldFolderPath, newFolderPath, freshItems, allContents, getItemPath);
                }
            } catch (e) {
                console.error('Failed to rename in vault', e);
            }
        }

        // 3. Update Search Index
        if (item.type === 'note') {
            const contentObj = await db.contents.get(item.id);
            if (contentObj) {
                const newPath = getItemPath(item.parentId, await db.items.toArray());
                updateSearchIndex(item.id, newTitle, contentObj.content, item.parentId, newPath, item.icon, item.tags);
            }
        }

        // 4. Trigger Sync
        localStorage.setItem('keim_has_user_edits', 'true');
        triggerAutoSync();
    },

    /**
     * Moves an item to a new parent folder, handling all Vault restructuring.
     */
    async moveItem(item: NoteItem, newParentId: number, newOrder: number): Promise<void> {
        if (!item.id || item.parentId === newParentId) {
             // Just update order if parent didn't change
             if (item.id && item.order !== newOrder) {
                 await updateItem(item.id, { order: newOrder });
                 triggerAutoSync();
             }
             return;
        }

        const allItems = await db.items.toArray();
        const oldParentPath = getItemPath(item.parentId, allItems);
        const newParentPath = getItemPath(newParentId, allItems);

        if (getStorageMode() === 'vault') {
            if (item.type === 'note') {
                const oldPath = notePathFromTitle(item.title, oldParentPath);
                const newPath = notePathFromTitle(item.title, newParentPath);
                if (oldPath !== newPath) {
                    try {
                        const contentObj = await db.contents.get(item.id);
                        await deleteFromVault(oldPath);
                        await writeNoteToVault(newPath, contentObj?.content || '');
                    } catch (err) {
                        console.warn('Physical move in vault failed', err);
                    }
                }
            } else if (item.type === 'folder') {
                const oldFolderPath = getItemPath(item.id, allItems);
                const newFolderPath = newParentPath ? `${newParentPath}/${item.title}` : item.title;
                
                if (oldFolderPath !== newFolderPath) {
                    try {
                        const allContents = await db.contents.toArray();
                        await moveVaultFolder(oldFolderPath, newFolderPath, allItems, allContents, getItemPath);
                    } catch (err) {
                        console.warn('Physical folder move in vault failed', err);
                    }
                }
            }
        }

        await updateItem(item.id, { parentId: newParentId, order: newOrder });
        triggerAutoSync();
    },

    /**
     * Deletes an item, its search index, and Vault file.
     */
    async removeItem(item: NoteItem): Promise<void> {
        if (!item.id) return;
        
        // 1. Physical vault delete BEFORE soft-delete in Dexie
        if (getStorageMode() === 'vault') {
            const allItems = await db.items.toArray();
            const parentPath = getItemPath(item.parentId, allItems);
            const vaultPath = item.type === 'note'
                ? notePathFromTitle(item.title, parentPath)
                : (parentPath ? `${parentPath}/${item.title}` : item.title);

            try {
                await deleteFromVault(vaultPath);
            } catch (err) {
                console.warn('Could not remove from vault (may already be deleted):', err);
            }
        }

        // 2. Soft delete in DB
        await deleteItem(item.id);
        
        // 3. Update search index
        if (item.type === 'note') {
            removeFromSearchIndex(item.id);
        }
        
        localStorage.setItem('keim_has_user_edits', 'true');
        triggerAutoSync();
    }
};
