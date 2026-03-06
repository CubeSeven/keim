import Dexie, { type Table } from 'dexie';

export interface NoteItem {
    id?: number;
    parentId: number; // 0 for root level
    type: 'folder' | 'note';
    title: string;
    tags?: string[];
    updated_at: number;
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

export async function addItem(item: Omit<NoteItem, 'id' | 'updated_at'>, initialContent: string = '') {
    return db.transaction('rw', db.items, db.contents, async () => {
        const id = await db.items.add({
            ...item,
            updated_at: Date.now()
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
    // Use a transaction to safely delete an item and all its nested descendants
    return db.transaction('rw', db.items, db.contents, async () => {
        const item = await db.items.get(id);
        if (!item) return;

        if (item.type === 'folder') {
            const children = await db.items.where('parentId').equals(id).toArray();
            for (const child of children) {
                if (child.id) await deleteItem(child.id); // Recursive delete
            }
        }

        await db.items.delete(id);
        await db.contents.delete(id);
    });
}

export async function moveItem(id: number, newParentId: number) {
    return updateItem(id, { parentId: newParentId });
}

// Fetch files and folders at root
export async function getRootItems() {
    return db.items.where('parentId').equals(0).toArray();
}

// Fetch children of a specific folder
export async function getChildren(parentId: number) {
    return db.items.where('parentId').equals(parentId).toArray();
}
