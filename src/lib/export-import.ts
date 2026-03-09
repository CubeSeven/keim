import { db, getFullPath } from './db';
import { notePathFromTitle } from './vault';

/**
 * Write a note to a specific directory handle recursively.
 * Does not depend on the global vault state.
 */
async function writeNoteToExtHandle(
    baseHandle: FileSystemDirectoryHandle,
    notePath: string,
    content: string
): Promise<void> {
    const parts = notePath.split('/');
    let dir = baseHandle;
    // Create necessary subdirectories
    for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
    }
    // Write the actual file
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await (fileHandle as any).createWritable();
    await writable.write(content);
    await writable.close();
}

/**
 * Exports all notes from IndexedDB to a user-selected folder.
 * This works regardless of the current storage mode.
 */
export async function exportToFolder() {
    // 1. Ask user for a destination folder
    if (!('showDirectoryPicker' in window)) {
        throw new Error("Your browser does not support folder export.");
    }

    const exportHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    if (!exportHandle) return 0;

    // 2. Fetch all current data
    const items = await db.items.toArray();
    const contents = await db.contents.toArray();
    const contentMap = new Map(contents.map(c => [c.id, c.content]));

    let exportedCount = 0;

    // 3. Write data to the selected handle
    for (const item of items) {
        if (item.type === 'note' && !item.isDeleted) {
            const content = contentMap.get(item.id!) || '';
            const parentPath = getFullPath(item.id!, items);

            const path = notePathFromTitle(item.title, parentPath);
            await writeNoteToExtHandle(exportHandle, path, content);
            exportedCount++;
        }
    }

    return exportedCount;
}

/**
 * Imports multiple .md files, preserving their folder hierarchy.
 */
export async function importMarkdownFiles(files: { file: File, path: string }[]) {
    const { addItem } = await import('./db');
    let importedCount = 0;

    // Cache to avoid recreating the same folder multiple times in one import run
    const folderCache = new Map<string, number>();
    folderCache.set('', 0); // Root is 0

    // Find or create a folder path and return its ID
    const ensurePathExists = async (pathStr: string): Promise<number> => {
        if (!pathStr) return 0;
        if (folderCache.has(pathStr)) return folderCache.get(pathStr)!;

        const parts = pathStr.split('/').filter(Boolean);
        let currentPath = '';
        let parentId = 0;

        for (const part of parts) {
            const nextPath = currentPath ? `${currentPath}/${part}` : part;

            if (folderCache.has(nextPath)) {
                parentId = folderCache.get(nextPath)!;
            } else {
                // We need to check if the folder already exists in DB from a previous session
                const existingFolders = await db.items.where({ type: 'folder', parentId }).toArray();
                const existing = existingFolders.find(f => f.title === part);

                if (existing) {
                    parentId = existing.id as number;
                } else {
                    // Create new folder
                    parentId = await addItem({
                        parentId,
                        type: 'folder',
                        title: part
                    });
                }
                folderCache.set(nextPath, parentId);
            }
            currentPath = nextPath;
        }
        return parentId;
    };

    for (const { file, path } of files) {
        if (file.name.endsWith('.md')) {
            const content = await file.text();
            const title = file.name.replace(/\.md$/, '');

            // e.g. "Docs/API/endpoint.md" -> folderPath: "Docs/API"
            const parts = path.split('/');
            parts.pop(); // remove filename
            const folderPath = parts.join('/');

            const parentId = await ensurePathExists(folderPath);

            // Check if note already exists
            const existing = await db.items
                .where('parentId').equals(parentId)
                .filter(i => i.title === title && !i.isDeleted && i.type === 'note')
                .first();

            if (!existing) {
                // Use the file's real lastModified so sync correctly
                // identifies cloud versions as newer if they are.
                await addItem({
                    parentId,
                    type: 'note',
                    title: title
                }, content, file.lastModified);
                importedCount++;
            }
        }
    }

    return importedCount;
}
