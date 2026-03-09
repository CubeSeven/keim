import Dexie, { type Table } from 'dexie';

export interface NoteItem {
    id?: number;
    parentId: number; // 0 for root level
    type: 'folder' | 'note';
    title: string;
    tags?: string[];
    updated_at: number;
    isDeleted?: boolean; // For sync tombstones
    parentPath?: string; // Vault path of parent folder (e.g. "Work")
    order?: number; // Custom sorting position
}

export interface NoteContent {
    id: number;
    content: string;
}

export class NotesDatabase extends Dexie {
    items!: Table<NoteItem, number>;
    contents!: Table<NoteContent, number>;

    constructor() {
        super('NotesDatabase');
        this.version(2).stores({
            items: '++id, parentId, type, title, *tags, updated_at',
            contents: 'id'
        });
    }
}

export const db = new NotesDatabase();

// --- Data Access Helpers ---

export async function addItem(
    item: Omit<NoteItem, 'id' | 'updated_at'>,
    initialContent: string = '',
    /** Optional timestamp override — use file.lastModified for imports */
    timestamp?: number
) {
    return db.transaction('rw', db.items, db.contents, async () => {
        const id = await db.items.add({
            ...item,
            order: Date.now(),
            updated_at: timestamp ?? Date.now()
        });
        if (item.type === 'note') {
            await db.contents.add({ id, content: initialContent });
        }
        return id;
    });
}

export async function updateItem(id: number, changes: Partial<Omit<NoteItem, 'id'>>) {
    return db.items.update(id, {
        ...changes,
        updated_at: Date.now()
    });
}

export async function updateContent(id: number, content: string) {
    return db.contents.put({ id, content });
}

export async function deleteItem(id: number): Promise<void> {
    // Soft delete to handle sync — keep content for recovery in case
    // sync later determines the deletion was wrong (e.g., another device
    // updated the note). Content is only truly purged during sync cleanup.
    return db.transaction('rw', db.items, db.contents, async () => {
        const item = await db.items.get(id);
        if (!item) return;

        if (item.type === 'folder') {
            const children = await db.items.where('parentId').equals(id).toArray();
            for (const child of children) {
                if (child.id) await deleteItem(child.id); // Recursive soft delete
            }
        }

        await db.items.update(id, { isDeleted: true, updated_at: Date.now() });
        // NOTE: Content is intentionally preserved here for sync safety.
        // It will be cleaned up after sync confirms the deletion propagated.
    });
}

/** Build the folder path for an item (e.g. "Work/Projects") */
export function getFullPath(itemId: number, allItems: NoteItem[]): string {
    const item = allItems.find(i => i.id === itemId);
    if (!item || item.parentId === 0) return '';
    const parentPath = getFullPath(item.parentId, allItems);
    const parent = allItems.find(i => i.id === item.parentId);
    if (!parent) return '';
    return parentPath ? `${parentPath}/${parent.title}` : parent.title;
}
