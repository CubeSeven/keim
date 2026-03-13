import Dexie, { type Table } from 'dexie';

// --- Smart Properties Types ---

export type FieldType = 'text' | 'number' | 'date' | 'link' | 'checkbox' | 'select' | 'relation';

export interface SmartField {
    name: string;
    type: FieldType;
    /** Used strictly by 'select' fields to provide dropdown options */
    options?: string[];
}

export interface SmartSchema {
    id?: number;
    folderId: number; // The NoteItem id of the parent folder
    fields: SmartField[];
}

export interface NoteItem {
    id?: number;
    parentId: number; // 0 for root level
    type: 'folder' | 'note';
    title: string;
    icon?: string;
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
    smartSchemas!: Table<SmartSchema, number>;

    constructor() {
        super('NotesDatabase');
        this.version(2).stores({
            items: '++id, parentId, type, title, *tags, updated_at, [type+title], [parentId+type]',
            contents: 'id'
        });
        this.version(3).stores({
            items: '++id, parentId, type, title, *tags, updated_at, [type+title], [parentId+type]',
            contents: 'id',
            smartSchemas: '++id, &folderId'
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
    return db.transaction('rw', db.items, db.contents, db.smartSchemas, async () => {
        const item = await db.items.get(id);
        if (!item) return;

        if (item.type === 'folder') {
            const children = await db.items.where('parentId').equals(id).toArray();
            for (const child of children) {
                if (child.id) await deleteItem(child.id); // Recursive soft delete
            }
        }

        await db.items.update(id, { isDeleted: true, updated_at: Date.now() });
        await db.smartSchemas.where({ folderId: id }).delete();
        // NOTE: Content is intentionally preserved here for sync safety.
        // It will be cleaned up after sync confirms the deletion propagated.
    });
}

/** Build the folder path for an item (e.g. "Work/Projects") */
export function getItemPath(itemId: number, allItems: NoteItem[]): string {
    if (itemId === 0) return '';
    const item = allItems.find(i => i.id === itemId);
    if (!item) return '';
    if (item.parentId === 0) return item.title;
    const parentPath = getItemPath(item.parentId, allItems);
    return parentPath ? `${parentPath}/${item.title}` : item.title;
}

export function getFullPath(itemId: number, allItems: NoteItem[]): string {
    const item = allItems.find(i => i.id === itemId);
    if (!item || item.parentId === 0) return '';
    return getItemPath(item.parentId, allItems);
}
