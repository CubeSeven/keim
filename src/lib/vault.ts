/**
 * vault.ts — File System Access API Layer
 * Provides Obsidian-style "vault" functionality using the browser's
 * File System Access API. Notes are stored as real .md files on disk.
 * Falls back gracefully on unsupported browsers (Firefox, Safari).
 */

// Key used to persist the vault directory handle in IndexedDB
const VAULT_IDB_KEY = 'keim_vault_handle';
const VAULT_MODE_LS_KEY = 'keim_storage_mode'; // 'vault' | 'indexeddb'

// --- FSA API Type Extensions ---
// These are not fully standardized in TypeScript's lib.dom yet.
interface FileSystemHandleExt extends FileSystemFileHandle {
    queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    entries(): AsyncIterable<[string, FileSystemHandle]>;
}
interface FSAWritableStream {
    write(data: string | ArrayBuffer | Blob): Promise<void>;
    close(): Promise<void>;
}
interface FileSystemFileHandleWritable {
    createWritable(): Promise<FSAWritableStream>;
}

// --- Feature Detection ---

export function isFileSystemSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) return false;
    return 'showDirectoryPicker' in window;
}

export function getStorageMode(): 'vault' | 'indexeddb' | 'unset' {
    const stored = localStorage.getItem(VAULT_MODE_LS_KEY);
    if (stored === 'vault' || stored === 'indexeddb') return stored;
    return 'unset';
}

export function setStorageMode(mode: 'vault' | 'indexeddb' | 'unset') {
    if (mode === 'unset') {
        localStorage.removeItem(VAULT_MODE_LS_KEY);
    } else {
        localStorage.setItem(VAULT_MODE_LS_KEY, mode);
    }
}

// --- Vault Handle Persistence (via IndexedDB directly) ---

function openHandleStore(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('KeimVaultMeta', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('handles');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveVaultHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await openHandleStore();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, VAULT_IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function loadVaultHandle(): Promise<FileSystemDirectoryHandle | null> {
    try {
        const db = await openHandleStore();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readonly');
            const req = tx.objectStore('handles').get(VAULT_IDB_KEY);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null;
    }
}

export async function hasSavedVault(): Promise<boolean> {
    const handle = await loadVaultHandle();
    return !!handle;
}

// --- Vault Picker ---

let _vaultHandle: FileSystemDirectoryHandle | null = null;

export async function openVaultPicker(): Promise<FileSystemDirectoryHandle | null> {
    if (!isFileSystemSupported()) return null;
    try {
        const handle = await (window as unknown as { showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' });
        _vaultHandle = handle;
        await saveVaultHandle(handle);
        setStorageMode('vault');
        return handle;
    } catch (e) {
        if ((e as Error).name === 'AbortError') return null; // User cancelled
        throw e;
    }
}

export async function restoreVaultHandle(requestPermissionIfPrompt = false): Promise<FileSystemDirectoryHandle | null> {
    const handle = await loadVaultHandle();
    if (!handle) return null;
    try {
        const handleExt = handle as unknown as FileSystemHandleExt;

        // 1. Check current permission silently
        let permission = await handleExt.queryPermission({ mode: 'readwrite' });

        // 2. Request permission if needed AND we are allowed to prompt (must be called from user gesture)
        if (permission === 'prompt' && requestPermissionIfPrompt) {
            permission = await handleExt.requestPermission({ mode: 'readwrite' });
        }

        if (permission === 'granted') {
            _vaultHandle = handle;
            return handle;
        }
        return null;
    } catch (e) {
        console.warn('Failed to restore vault handle', e);
        return null;
    }
}

// --- Vault File Tree ---

interface VaultNote {
    path: string;       // relative path from vault root, e.g. "Work/Meeting.md"
    title: string;      // filename without .md
    parentPath: string; // parent folder path, "" for root
    updatedAt: number;
}

interface VaultFolder {
    path: string;
    name: string;
    parentPath: string;
}

interface VaultTree {
    notes: VaultNote[];
    folders: VaultFolder[];
}

async function readDirRecursive(
    dirHandle: FileSystemDirectoryHandle,
    basePath: string,
    tree: VaultTree
): Promise<void> {
    for await (const [name, entry] of (dirHandle as unknown as FileSystemHandleExt).entries()) {
        // Skip hidden files/folders (like .git, .DS_Store)
        if (name.startsWith('.')) continue;

        if (entry.kind === 'directory') {
            const folderPath = basePath ? `${basePath}/${name}` : name;
            tree.folders.push({ path: folderPath, name, parentPath: basePath });
            await readDirRecursive(entry as FileSystemDirectoryHandle, folderPath, tree);
        } else if (entry.kind === 'file' && name.endsWith('.md')) {
            const file = await (entry as FileSystemFileHandle).getFile();
            const notePath = basePath ? `${basePath}/${name}` : name;
            tree.notes.push({
                path: notePath,
                title: name.replace(/\.md$/, ''),
                parentPath: basePath,
                updatedAt: file.lastModified,
            });
        }
    }
}

async function readVaultTree(): Promise<VaultTree | null> {
    if (!_vaultHandle) return null;
    const tree: VaultTree = { notes: [], folders: [] };
    await readDirRecursive(_vaultHandle, '', tree);
    return tree;
}

// --- Note Read/Write ---

async function readNoteContent(notePath: string): Promise<string> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = notePath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: false });
    const file = await fileHandle.getFile();
    return file.text();
}

export async function writeNoteToVault(notePath: string, content: string): Promise<void> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = notePath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await (fileHandle as unknown as FileSystemFileHandleWritable).createWritable();
    await writable.write(content);
    await writable.close();
}

/**
 * Delete any file or folder from the vault by its relative path.
 * For folders, deletion is recursive (removes all children).
 */
export async function deleteFromVault(relativePath: string): Promise<void> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = relativePath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    try {
        for (let i = 0; i < parts.length - 1; i++) {
            dir = await dir.getDirectoryHandle(parts[i], { create: false });
        }
        await dir.removeEntry(parts[parts.length - 1], { recursive: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
        // If it's already gone (NotFoundError) or we can't find the parent, 
        // that's fine, the goal of deletion is met.
        if (e.name === 'NotFoundError') {
            return;
        }
        throw e;
    }
}

/** Convert a note title + parent path to a file path */
export function notePathFromTitle(title: string, parentPath: string): string {
    const safeName = title.replace(/[<>:"/\\|?*]/g, '_') + '.md';
    return parentPath ? `${parentPath}/${safeName}` : safeName;
}

/**
 * Synchronize the physical vault directory into IndexedDB.
 *
 * Reads the vault file tree, creates/updates/soft-deletes items in Dexie to
 * match, then reconciles the disk so the two stay in sync.
 *
 * Extracted from `useAppInit` so it can live at the library layer and be
 * independently tested without needing React hooks.
 *
 * @param selectedNotePath  The last-known selected note path (from persisted store).
 * @param setSelectedNoteId Callback to update the selected note ID in the store.
 */
export async function loadVaultIntoDb(
    selectedNotePath: string | null,
    setSelectedNoteId: (id: number | null) => void
): Promise<void> {
    // Lazy imports to avoid circular dependency — these modules import from vault.ts
    const { db, getItemPath, getFullPath } = await import('./db');

    const tree = await readVaultTree();
    if (!tree) return;

    const existingItems = await db.items.toArray();
    const existingMap = new Map<string, typeof existingItems[0]>();

    const buildPath = (item: typeof existingItems[0]): string => {
        const parentPath = getItemPath(item.parentId, existingItems);
        if (item.type === 'note') {
            const safeName = item.title.replace(/[<>:"/\\|?*]/g, '_') + '.md';
            return parentPath ? `${parentPath}/${safeName}` : safeName;
        }
        return parentPath ? `${parentPath}/${item.title}` : item.title;
    };

    existingItems.forEach(item => {
        if (!item.isDeleted) existingMap.set(buildPath(item), item);
    });

    const currentVaultPaths = new Set<string>();
    const folderPathToId = new Map<string, number>();
    folderPathToId.set('', 0);

    const sortedFolders = [...tree.folders].sort((a, b) => a.path.split('/').length - b.path.split('/').length);

    for (const folder of sortedFolders) {
        currentVaultPaths.add(folder.path);
        const parentId = folderPathToId.get(folder.parentPath) ?? 0;
        const existingFolder = existingMap.get(folder.path);

        if (existingFolder && existingFolder.type === 'folder') {
            folderPathToId.set(folder.path, existingFolder.id!);
            if (existingFolder.parentId !== parentId) await db.items.update(existingFolder.id!, { parentId });
        } else {
            const id = await db.items.add({ parentId, type: 'folder', title: folder.name, updated_at: Date.now() });
            folderPathToId.set(folder.path, id as number);
        }
    }

    for (const note of tree.notes) {
        currentVaultPaths.add(note.path);
        const parentId = folderPathToId.get(note.parentPath) ?? 0;
        const existingNote = existingMap.get(note.path);
        let noteId: number;

        if (existingNote && existingNote.type === 'note') {
            noteId = existingNote.id!;
            try {
                const vaultContent = await readNoteContent(note.path);
                const dexieContent = await db.contents.get(noteId);
                if (dexieContent?.content !== vaultContent) {
                    await db.contents.put({ id: noteId, content: vaultContent });
                    await db.items.update(noteId, { updated_at: note.updatedAt, parentId });
                } else if (existingNote.parentId !== parentId) {
                    await db.items.update(noteId, { parentId });
                }
            } catch (e) { console.warn('Failed to read vault content for comparison:', note.path, e); }
        } else {
            noteId = (await db.items.add({ parentId, type: 'note', title: note.title, updated_at: note.updatedAt })) as number;
            try { await db.contents.add({ id: noteId, content: await readNoteContent(note.path) }); }
            catch { await db.contents.add({ id: noteId, content: '' }); }
        }
    }

    for (const [path, existingItem] of existingMap.entries()) {
        if (!currentVaultPaths.has(path) && !existingItem.isDeleted) {
            await db.items.update(existingItem.id!, { isDeleted: true, updated_at: Date.now() });
        }
    }

    try {
        const allItems = await db.items.toArray();
        const allContents = await db.contents.toArray();
        await reconcileVault(allItems, allContents, getItemPath);
    } catch (e) {
        console.error('Failed to reconcile vault after load:', e);
    }

    if (selectedNotePath) {
        const items = await db.items.toArray();
        const matchedNode = items.find(item => {
            if (item.type !== 'note') return false;
            const parentPathStr = getFullPath(item.id!, items);
            const fullPathStr = parentPathStr ? `${parentPathStr}/${item.title}` : item.title;
            return fullPathStr === selectedNotePath;
        });
        setSelectedNoteId(matchedNode ? matchedNode.id! : null);
    }
}




/** Create a directory recursively in the vault */
export async function createFolderInVault(folderPath: string): Promise<void> {
    if (!_vaultHandle) throw new Error('No vault open');
    const parts = folderPath.split('/');
    let dir: FileSystemDirectoryHandle = _vaultHandle;
    for (const part of parts) {
        if (part) dir = await dir.getDirectoryHandle(part, { create: true });
    }
}

/** 
 * Helper to physically move a folder and all its contents in the vault.
 * Since the FSA API doesn't support folder renaming, we must:
 * 1. Create the new folder path
 * 2. Find all notes inside the old folder from the DB
 * 3. Rewrite them to the new paths
 * 4. Delete the old folder
 */
export async function moveVaultFolder(
    oldFolderPath: string,
    newFolderPath: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allDbItems: any[], // using any to avoid direct circular dep on db.ts types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allDbContents: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getItemPath: (id: number, items: any[]) => string
): Promise<void> {
    if (!_vaultHandle) return;
    if (oldFolderPath === newFolderPath) return;

    // 1. Ensure the new directory exists
    await createFolderInVault(newFolderPath);

    // 2. Find all notes that are descendants of this folder (path starts with oldFolderPath)
    const descendantNotes = allDbItems.filter(item => {
        if (item.type !== 'note' || item.isDeleted) return false;
        const parentPath = getItemPath(item.parentId, allDbItems);
        return parentPath === oldFolderPath || parentPath.startsWith(oldFolderPath + '/');
    });

    const contentMap = new Map(allDbContents.map(c => [c.id, c.content]));

    // 3. Rewrite all notes to their new paths
    for (const note of descendantNotes) {
        const oldNoteParentPath = getItemPath(note.parentId, allDbItems);
        // Replace the prefix
        const newNoteParentPath = oldFolderPath === oldNoteParentPath 
            ? newFolderPath 
            : newFolderPath + oldNoteParentPath.substring(oldFolderPath.length);
        
        const newNotePath = notePathFromTitle(note.title, newNoteParentPath);
        const content = contentMap.get(note.id) || '';
        
        await writeNoteToVault(newNotePath, content);
    }

    // 4. Delete the old folder recursively
    try {
        await deleteFromVault(oldFolderPath);
    } catch (e) {
        console.warn(`Failed to delete old folder after move: ${oldFolderPath}`, e);
        // Fallback: If removeEntry fails (e.g., due to hidden OS files), 
        // the reconciliation step will eventually clean it up anyway now that
        // we fixed getFullPath in expectedFolderPaths.
    }
}

/**
 * Robustly reconciles the physical vault disk to match the DB state.
 * This is the 'Source of Truth' enforcer.
 */
export async function reconcileVault(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allDbItems: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allDbContents: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getItemPath: (id: number, items: any[]) => string,
    targetItemIds?: number[] // Optional: only reconcile these specific items
): Promise<void> {
    if (!_vaultHandle) return;

    // 1. Get current physical state
    const physicalTree = await readVaultTree();
    if (!physicalTree) return;

    const contentMap = new Map<number, string>(allDbContents.map(c => [c.id, c.content]));

    // 2. Identify all expected paths from DB
    const expectedPaths = new Set<string>();
    const expectedNotePaths = new Map<string, number>(); // path -> id
    const expectedFolderPaths = new Set<string>();

    for (const item of allDbItems) {
        if (item.isDeleted) continue;
        
        if (item.type === 'note') {
            const parentPath = getItemPath(item.parentId, allDbItems);
            const fullPath = notePathFromTitle(item.title, parentPath);
            expectedPaths.add(fullPath);
            expectedNotePaths.set(fullPath, item.id!);
        } else {
            const fullPath = getItemPath(item.id!, allDbItems);
            expectedPaths.add(fullPath);
            expectedFolderPaths.add(fullPath);
        }
    }

    // 3. Cleanup: Delete physical items NOT in expectedPaths
    // Skip cleanup if we're only reconciling specific items (incremental mode)
    if (!targetItemIds) {
        const physicalFolders = [...physicalTree.folders].sort((a, b) => b.path.length - a.path.length);
        for (const pf of physicalFolders) {
            if (!expectedFolderPaths.has(pf.path)) {
                try { await deleteFromVault(pf.path); } catch { /* ignore */ }
            }
        }
        for (const pn of physicalTree.notes) {
            if (!expectedNotePaths.has(pn.path)) {
                try { await deleteFromVault(pn.path); } catch { /* ignore */ }
            }
        }
    }

    // 4. Create/Update physical items from DB
    const targetSet = targetItemIds ? new Set(targetItemIds) : null;

    // Folders
    const dbFolders = allDbItems.filter(i => i.type === 'folder' && !i.isDeleted && (!targetSet || targetSet.has(i.id!)))
        .sort((a, b) => getItemPath(a.id!, allDbItems).length - getItemPath(b.id!, allDbItems).length);
    
    for (const df of dbFolders) {
        const fullPath = getItemPath(df.id!, allDbItems);
        await createFolderInVault(fullPath);
    }

    // Notes
    const dbNotes = allDbItems.filter(i => i.type === 'note' && !i.isDeleted && (!targetSet || targetSet.has(i.id!)));
    for (const dn of dbNotes) {
        const parentPath = getItemPath(dn.parentId, allDbItems);
        const fullPath = notePathFromTitle(dn.title, parentPath);
        const content = contentMap.get(dn.id!) || '';
        
        const physicalNote = physicalTree.notes.find(pn => pn.path === fullPath);
        
        if (!physicalNote) {
            await writeNoteToVault(fullPath, content);
        } else {
            // Efficiency: Compare DB updated_at with Disk lastModified.
            // Note: Disk precision might be lower (seconds vs ms), so we allow a small drift (1000ms).
            const diskModified = physicalNote.updatedAt;
            const dbUpdated = dn.updated_at;

            // If disk is older than DB, OR if DB is significantly newer (sync), overwrite.
            // If timestamps match closely, skip the expensive content read.
            if (Math.abs(diskModified - dbUpdated) > 2000) {
                const currentContent = await readNoteContent(fullPath).catch(() => null);
                if (currentContent !== content) {
                    await writeNoteToVault(fullPath, content);
                }
            }
        }
    }
}
